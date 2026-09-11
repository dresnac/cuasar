import { dbAdmin, eq, pgClient, schema, sql, withTenant, type TenantCtx } from '@cuasar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addNote,
  attachImages,
  createVehicle,
  getVehicle,
  listTimeline,
  listVehicles,
  transitionVehicle,
} from '../src/services';

/**
 * El núcleo de vehículos contra la base real.
 *
 * Los tests de dominio prueban las reglas; estos prueban que las reglas
 * sobreviven al viaje hasta Postgres: que el evento se escribe en la misma
 * transacción que el cambio, que publicar mueve la proyección del catálogo,
 * y que un vendedor no recibe márgenes ni siquiera en el payload.
 *
 * Requiere: pnpm db:migrate && pnpm db:seed
 */

let owner: TenantCtx;
let sales: TenantCtx;
let agencyId: string;
let createdId: string;

beforeAll(async () => {
  const [agency] = await dbAdmin.execute<{ id: string }>(
    sql`select id from agencies where slug = 'del-sur' limit 1`,
  );
  if (!agency) throw new Error('Falta el seed: pnpm db:seed');
  agencyId = agency.id;

  const members = await dbAdmin.execute<{ user_id: string; role: string }>(
    sql`select user_id, role from memberships where agency_id = ${agencyId}`,
  );

  const ownerRow = members.find((m) => m.role === 'OWNER')!;
  const salesRow = members.find((m) => m.role === 'SALES')!;

  owner = { agencyId, userId: ownerRow.user_id, role: 'OWNER' };
  sales = { agencyId, userId: salesRow.user_id, role: 'SALES' };
});

afterAll(async () => {
  if (createdId) {
    await dbAdmin.execute(sql`delete from vehicles where id = ${createdId}`);
  }
  await pgClient.end();
});

describe('listado', () => {
  it('devuelve el stock de la agencia con antigüedad calculada', async () => {
    const result = await listVehicles(owner, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.items.length).toBeGreaterThan(0);
    for (const item of result.data.items) {
      expect(item.daysInStock).toBeGreaterThanOrEqual(0);
      expect(item.daysInStatus).toBeGreaterThanOrEqual(0);
    }
  });

  it('ordenar por "más tiempo parados" pone primero al más viejo', async () => {
    const result = await listVehicles(owner, { sort: 'stale' });
    if (!result.ok) throw new Error('falló el listado');

    const days = result.data.items.map((i) => i.daysInStock);
    expect(days).toEqual([...days].sort((a, b) => b - a));
  });

  it('filtra consignaciones', async () => {
    const result = await listVehicles(owner, { ownership: 'CONSIGNMENT' });
    if (!result.ok) throw new Error('falló el listado');

    expect(result.data.items.length).toBeGreaterThan(0);
    expect(result.data.items.every((i) => i.ownership === 'CONSIGNMENT')).toBe(true);
  });

  it('la paginación por keyset no repite ni saltea filas', async () => {
    const first = await listVehicles(owner, { limit: 3 });
    if (!first.ok || !first.data.nextCursor) throw new Error('se esperaba una segunda página');

    const second = await listVehicles(owner, { limit: 3, cursor: first.data.nextCursor });
    if (!second.ok) throw new Error('falló la segunda página');

    const ids = [...first.data.items, ...second.data.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('el dueño sí recibe capital invertido y margen, y los números cierran', async () => {
    const result = await listVehicles(owner, { ownership: 'OWNED' });
    if (!result.ok) throw new Error('falló el listado');

    const sold = result.data.items.find((i) => i.status === 'VENDIDO');
    expect(sold?.investedBaseCents).toBeGreaterThan(0n);
    expect(sold?.marginBaseCents).not.toBeNull();

    // Lo mismo que dice la ficha tiene que decir la lista: una proyección
    // que se contradice con la otra es peor que no tenerla.
    const detail = await getVehicle(owner, sold!.id);
    expect(sold!.marginBaseCents).toBe(detail!.financials!.grossMarginBaseCents);
    expect(sold!.investedBaseCents).toBe(
      detail!.financials!.acquisitionBaseCents + detail!.financials!.costsBaseCents,
    );
  });

  it('un vendedor no recibe márgenes: no se ocultan en la UI, no se mandan', async () => {
    const result = await listVehicles(sales, {});
    if (!result.ok) throw new Error('falló el listado');

    expect(result.data.items.every((i) => i.marginBaseCents === null)).toBe(true);
    expect(result.data.items.every((i) => i.investedBaseCents === null)).toBe(true);
  });
});

describe('alta y ciclo de vida', () => {
  it('rechaza un vehículo propio sin precio de compra', async () => {
    const result = await createVehicle(owner, {
      brand: 'Nissan',
      model: 'Kicks',
      year: 2021,
      ownership: 'OWNED',
      listPrice: { amountCents: 2_000_000n, currency: 'USD', fxRate: '1', amountBaseCents: 2_000_000n },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
  });

  it('crea la unidad y escribe su primer evento en la misma operación', async () => {
    const result = await createVehicle(owner, {
      brand: 'Nissan',
      model: 'Kicks',
      version: 'Advance CVT',
      year: 2021,
      km: 55_000,
      ownership: 'OWNED',
      listPrice: { amountCents: 2_050_000n, currency: 'USD', fxRate: '1', amountBaseCents: 2_050_000n },
      acquisition: {
        amountCents: 1_800_000n,
        currency: 'USD',
        fxRate: '1',
        amountBaseCents: 1_800_000n,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdId = result.data.id;

    const timeline = await listTimeline(owner, createdId);
    if (!timeline.ok) throw new Error('falló el timeline');
    expect(timeline.data.entries[0]?.type).toBe('VEHICLE_CREATED');
  });

  it('no publica sin fotos, aunque tenga precio', async () => {
    const result = await transitionVehicle(owner, createdId, 'PUBLICADO');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/fotos/i);
  });

  it('con fotos publica, y la unidad aparece en el catálogo público', async () => {
    const added = await attachImages(owner, createdId, [
      {
        blobUrl: 'https://example.test/foto-1.jpg',
        blobPathname: 'test/foto-1.jpg',
        width: 1200,
        height: 800,
        bytes: 120_000,
      },
    ]);
    expect(added.ok).toBe(true);

    const published = await transitionVehicle(owner, createdId, 'PUBLICADO');
    expect(published.ok).toBe(true);

    // La proyección la mantiene un trigger: si el estado cambió, el catálogo
    // ya cambió, sin un job de sincronización de por medio.
    const [inCatalog] = await dbAdmin.execute<{ image_count: number }>(
      sql`select image_count from vehicle_public_view where vehicle_id = ${createdId}`,
    );
    expect(inCatalog?.image_count).toBe(1);
  });

  it('pausar lo saca del catálogo', async () => {
    const paused = await transitionVehicle(owner, createdId, 'PAUSADO');
    expect(paused.ok).toBe(true);

    const rows = await dbAdmin.execute(
      sql`select 1 from vehicle_public_view where vehicle_id = ${createdId}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('un auto propio no se puede devolver al dueño', async () => {
    const result = await transitionVehicle(owner, createdId, 'DEVUELTO');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_TRANSITION');
  });

  it('el timeline cuenta la historia completa, en orden', async () => {
    await addNote(owner, createdId, 'Le falta la rueda de auxilio.');

    const timeline = await listTimeline(owner, createdId);
    if (!timeline.ok) throw new Error('falló el timeline');

    const types = timeline.data.entries.map((e) => e.type);
    expect(types[0]).toBe('NOTE_ADDED');
    expect(types).toContain('PUBLISHED');
    expect(types).toContain('UNPUBLISHED');
    expect(types).toContain('IMAGES_ADDED');
    expect(types.at(-1)).toBe('VEHICLE_CREATED');
  });
});

describe('ficha', () => {
  it('el dueño ve la contabilidad de la unidad', async () => {
    const vehicle = await getVehicle(owner, createdId);
    expect(vehicle?.financials?.acquisitionBaseCents).toBe(1_800_000n);
    expect(vehicle?.acquisition).not.toBeNull();
  });

  it('el vendedor ve la ficha pero no la plata de costos', async () => {
    const vehicle = await getVehicle(sales, createdId);
    expect(vehicle?.brand).toBe('Nissan');
    expect(vehicle?.financials).toBeNull();
    expect(vehicle?.acquisition).toBeNull();
  });

  it('un vendedor no puede cambiar el precio de lista', async () => {
    const { updateVehicle } = await import('../src/services');
    const result = await updateVehicle(sales, createdId, {
      listPrice: { amountCents: 1n, currency: 'USD', fxRate: '1', amountBaseCents: 1n },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });

  it('una agencia no ve la ficha de otra ni pidiéndola por id', async () => {
    const [other] = await dbAdmin.execute<{ id: string; user_id: string }>(sql`
      select a.id, m.user_id from agencies a
      join memberships m on m.agency_id = a.id
      where a.slug = 'norte-motors' limit 1
    `);

    const intruder: TenantCtx = { agencyId: other!.id, userId: other!.user_id, role: 'OWNER' };
    expect(await getVehicle(intruder, createdId)).toBeNull();
  });
});
