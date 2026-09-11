import { dbAdmin, inArray, pgClient, schema, sql, type TenantCtx } from '@cuasar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attachImages,
  createVehicle,
  getDashboard,
  getVehicle,
  listCosts,
  listTimeline,
  registerCost,
  registerSale,
  removeCost,
  transitionVehicle,
} from '../src/services';

/**
 * Contabilidad contra la base real.
 *
 * Lo que estos tests cuidan no es que las cuentas den: eso lo prueban los
 * tests de dominio. Es que la proyección que mantienen los triggers diga lo
 * mismo que la fórmula, y que propio y consignación no se mezclen nunca.
 *
 * Requiere: pnpm db:migrate && pnpm db:seed
 */

const usd = (n: number) => BigInt(Math.round(n * 100));
const money = (n: number) => ({
  amountCents: usd(n),
  currency: 'USD' as const,
  fxRate: '1',
  amountBaseCents: usd(n),
});

let owner: TenantCtx;
let sales: TenantCtx;
const created: string[] = [];

async function newVehicle(opts: {
  ownership: 'OWNED' | 'CONSIGNMENT';
  list: number;
  buy?: number;
  floor?: number;
  commission?: string;
}) {
  const result = await createVehicle(owner, {
    brand: 'Test',
    model: `Unidad-${created.length}`,
    year: 2022,
    ownership: opts.ownership,
    listPrice: money(opts.list),
    acquisition: opts.ownership === 'OWNED' ? money(opts.buy ?? 0) : null,
    consignment:
      opts.ownership === 'CONSIGNMENT'
        ? {
            consignorName: 'Dueño de prueba',
            agreedFloor: money(opts.floor ?? 0),
            commissionType: 'PCT' as const,
            commissionValue: opts.commission ?? '5',
            contractStartsAt: new Date().toISOString().slice(0, 10),
          }
        : null,
  });

  if (!result.ok) throw new Error(result.error.message);
  created.push(result.data.id);

  await attachImages(owner, result.data.id, [
    {
      blobUrl: 'https://example.test/x.jpg',
      blobPathname: 'test/x.jpg',
      width: 800,
      height: 600,
      bytes: 1000,
    },
  ]);
  await transitionVehicle(owner, result.data.id, 'PUBLICADO');

  return result.data.id;
}

beforeAll(async () => {
  const [agency] = await dbAdmin.execute<{ id: string }>(
    sql`select id from agencies where slug = 'del-sur' limit 1`,
  );
  if (!agency) throw new Error('Falta el seed: pnpm db:seed');

  const members = await dbAdmin.execute<{ user_id: string; role: string }>(
    sql`select user_id, role from memberships where agency_id = ${agency.id}`,
  );

  owner = {
    agencyId: agency.id,
    userId: members.find((m) => m.role === 'OWNER')!.user_id,
    role: 'OWNER',
  };
  sales = {
    agencyId: agency.id,
    userId: members.find((m) => m.role === 'SALES')!.user_id,
    role: 'SALES',
  };
});

afterAll(async () => {
  if (created.length) {
    await dbAdmin.delete(schema.vehicles).where(inArray(schema.vehicles.id, created));
  }
  await pgClient.end();
});

describe('gastos', () => {
  it('un gasto baja el capital disponible y queda en el historial', async () => {
    const id = await newVehicle({ ownership: 'OWNED', list: 20_000, buy: 16_000 });

    const result = await registerCost(owner, id, {
      category: 'MECHANICAL',
      description: 'Distribución',
      value: money(900),
    });
    expect(result.ok).toBe(true);

    // El trigger ya corrió: cuando la llamada vuelve, la proyección está al día.
    const vehicle = await getVehicle(owner, id);
    expect(vehicle?.financials?.costsBaseCents).toBe(usd(900));

    const timeline = await listTimeline(owner, id);
    if (!timeline.ok) throw new Error('falló el timeline');
    expect(timeline.data.entries[0]?.type).toBe('COST_REGISTERED');
  });

  it('varios gastos se acumulan', async () => {
    const id = await newVehicle({ ownership: 'OWNED', list: 20_000, buy: 16_000 });

    await registerCost(owner, id, { category: 'DETAILING', value: money(150) });
    await registerCost(owner, id, { category: 'PAPERWORK', value: money(320) });

    const vehicle = await getVehicle(owner, id);
    expect(vehicle?.financials?.costsBaseCents).toBe(usd(470));
    expect(await listCosts(owner, id)).toHaveLength(2);
  });

  it('borrar un gasto devuelve el margen y deja constancia', async () => {
    const id = await newVehicle({ ownership: 'OWNED', list: 20_000, buy: 16_000 });

    const cost = await registerCost(owner, id, { category: 'BODYWORK', value: money(500) });
    if (!cost.ok) throw new Error('no se pudo registrar');

    expect((await removeCost(owner, id, cost.data.id)).ok).toBe(true);

    const vehicle = await getVehicle(owner, id);
    expect(vehicle?.financials?.costsBaseCents).toBe(0n);

    const timeline = await listTimeline(owner, id);
    if (!timeline.ok) throw new Error('falló el timeline');
    expect(timeline.data.entries[0]?.type).toBe('COST_REMOVED');
  });

  it('un vendedor no registra gastos ni los lee', async () => {
    const id = await newVehicle({ ownership: 'OWNED', list: 20_000, buy: 16_000 });

    const result = await registerCost(sales, id, { category: 'OTHER', value: money(100) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');

    expect(await listCosts(sales, id)).toHaveLength(0);
  });
});

describe('venta de una unidad propia', () => {
  it('margen = venta − compra − gastos, y la proyección coincide con la fórmula', async () => {
    const id = await newVehicle({ ownership: 'OWNED', list: 24_000, buy: 19_000 });
    await registerCost(owner, id, { category: 'MECHANICAL', value: money(1_200) });

    const sale = await registerSale(owner, id, {
      value: money(23_500),
      buyerName: 'Comprador',
      paymentMethod: 'Transferencia',
    });

    expect(sale.ok).toBe(true);
    if (!sale.ok) return;
    expect(sale.data.marginBaseCents).toBe(usd(23_500 - 19_000 - 1_200));

    const vehicle = await getVehicle(owner, id);
    expect(vehicle?.status).toBe('VENDIDO');
    expect(vehicle?.financials?.grossMarginBaseCents).toBe(sale.data.marginBaseCents);
    expect(vehicle?.financials?.daysInStock).not.toBeNull();
  });

  it('vender no es un cambio de estado suelto: deja la venta y sus dos eventos', async () => {
    const id = await newVehicle({ ownership: 'OWNED', list: 15_000, buy: 12_000 });
    await registerSale(owner, id, { value: money(14_000) });

    const timeline = await listTimeline(owner, id);
    if (!timeline.ok) throw new Error('falló el timeline');

    const types = timeline.data.entries.map((e) => e.type);
    expect(types).toContain('SOLD');
    expect(types).toContain('STATUS_CHANGED');

    const rows = await dbAdmin.execute(sql`select 1 from vehicle_sales where vehicle_id = ${id}`);
    expect(rows).toHaveLength(1);
  });

  it('una unidad recién ingresada no se puede vender', async () => {
    const result = await createVehicle(owner, {
      brand: 'Test',
      model: 'SinPublicar',
      year: 2022,
      ownership: 'OWNED',
      listPrice: money(10_000),
      acquisition: money(8_000),
    });
    if (!result.ok) throw new Error('no se pudo crear');
    created.push(result.data.id);

    // Un auto que nunca se publicó ni se preparó no puede saltar a vendido:
    // el timeline tiene que poder explicar cómo llegó ahí.
    const sale = await registerSale(owner, result.data.id, { value: money(9_500) });
    expect(sale.ok).toBe(false);
    if (!sale.ok) expect(sale.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('venta en consignación', () => {
  it('el resultado es la comisión menos los gastos, no venta menos compra', async () => {
    const id = await newVehicle({
      ownership: 'CONSIGNMENT',
      list: 30_000,
      floor: 28_000,
      commission: '5',
    });
    await registerCost(owner, id, { category: 'DETAILING', value: money(200) });

    const sale = await registerSale(owner, id, { value: money(29_000) });
    expect(sale.ok).toBe(true);
    if (!sale.ok) return;

    // 5% de 29.000 = 1.450, menos 200 de gastos.
    expect(sale.data.marginBaseCents).toBe(usd(1_450 - 200));

    const vehicle = await getVehicle(owner, id);
    expect(vehicle?.financials?.commissionBaseCents).toBe(usd(1_450));
    // El capital del dueño nunca entra en la cuenta de la agencia.
    expect(vehicle?.financials?.acquisitionBaseCents).toBe(0n);
  });

  it('no deja vender por debajo del piso acordado con el dueño', async () => {
    const id = await newVehicle({
      ownership: 'CONSIGNMENT',
      list: 30_000,
      floor: 28_000,
      commission: '5',
    });

    const sale = await registerSale(owner, id, { value: money(26_000) });
    expect(sale.ok).toBe(false);
    if (!sale.ok) expect(sale.error.message).toMatch(/piso/i);
  });
});

describe('dashboard', () => {
  const range = {
    from: new Date(Date.now() - 365 * 86_400_000),
    to: new Date(Date.now() + 86_400_000),
  };

  it('el capital inmovilizado cuenta solo unidades propias en stock', async () => {
    const result = await getDashboard(owner, range, 'USD');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { portfolio, aging } = result.data;
    expect(portfolio.ownedCount).toBeGreaterThan(0);
    expect(portfolio.consignmentCount).toBeGreaterThan(0);
    expect(portfolio.capitalTiedBaseCents).toBeGreaterThan(0n);

    // Los tramos de antigüedad tienen que cubrir exactamente el stock.
    const unitsInBuckets = aging.reduce((acc, b) => acc + b.units, 0);
    expect(unitsInBuckets).toBe(portfolio.ownedCount + portfolio.consignmentCount);
  });

  it('los totales del período coinciden con la suma de propio y consignación', async () => {
    const result = await getDashboard(owner, range, 'USD');
    if (!result.ok) throw new Error('falló el dashboard');

    const { period } = result.data;
    expect(period.owned.units + period.consignment.units).toBe(period.unitsSold);
    expect(period.owned.marginBaseCents + period.consignment.marginBaseCents).toBe(
      period.marginBaseCents,
    );
  });

  it('devuelve los doce meses, también los que no tuvieron ventas', async () => {
    const result = await getDashboard(owner, range, 'USD');
    if (!result.ok) throw new Error('falló el dashboard');

    expect(result.data.monthly).toHaveLength(12);
    expect(result.data.monthly.some((m) => m.unitsSold > 0)).toBe(true);
  });

  it('un vendedor no entra al dashboard contable', async () => {
    const result = await getDashboard(sales, range, 'USD');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
});
