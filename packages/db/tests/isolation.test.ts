import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../src/env';
import { dbAdmin, pgClient, withPlatform, withTenant } from '../src/client';
import * as s from '../src/schema';

/**
 * El muro del sistema.
 *
 * Estos tests intentan explícitamente cruzar el aislamiento entre agencias.
 * Si alguno pasa cuando no debería, hay una fuga de datos entre clientes —
 * el riesgo número uno del diseño. Corren en CI en cada PR.
 *
 * Requieren la base seedeada: pnpm db:migrate && pnpm db:seed
 */


/**
 * Drizzle envuelve el error de Postgres en "Failed query: …" y deja el
 * original en `cause`. Sin esto, un test pasaría con cualquier error,
 * incluido un typo en el SQL — que es exactamente lo que no queremos
 * en los tests que prueban que algo está prohibido.
 */
async function expectDbError(run: () => Promise<unknown>, pattern: RegExp) {
  try {
    await run();
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause;
    const message = cause?.message ?? (err as Error).message;
    expect(message).toMatch(pattern);
    return;
  }
  throw new Error(`Se esperaba un error de Postgres que matchee ${pattern}, pero no hubo error.`);
}

let A: string;
let B: string;
let vehicleOfB: string;
let userOfB: string;

const ctx = (agencyId: string) => ({ agencyId, userId: userOfB ?? agencyId, role: 'OWNER' as const });

beforeAll(async () => {
  const rows = await dbAdmin.execute<{ id: string; slug: string }>(
    sql`select id, slug from agencies order by slug`,
  );
  if (rows.length < 2) {
    throw new Error('Se necesitan al menos dos agencias seedeadas: pnpm db:seed');
  }
  A = rows[0]!.id;
  B = rows[1]!.id;

  const [v] = await dbAdmin.execute<{ id: string }>(
    sql`select id from vehicles where agency_id = ${B} limit 1`,
  );
  vehicleOfB = v!.id;

  const [u] = await dbAdmin.execute<{ user_id: string }>(
    sql`select user_id from memberships where agency_id = ${B} limit 1`,
  );
  userOfB = u!.user_id;
});

afterAll(async () => {
  await pgClient.end();
});

describe('aislamiento entre agencias', () => {
  it('un tenant solo ve sus propios vehículos, aunque el query no filtre', async () => {
    const rows = await withTenant(ctx(A), (tx) =>
      // Deliberadamente SIN where agency_id: es el caso que RLS tiene que cubrir.
      tx.select({ id: s.vehicles.id, agencyId: s.vehicles.agencyId }).from(s.vehicles),
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.agencyId === A)).toBe(true);
  });

  it('no puede leer un vehículo de otra agencia ni pidiéndolo por id', async () => {
    const rows = await withTenant(ctx(A), (tx) =>
      tx.execute(sql`select id from vehicles where id = ${vehicleOfB}`),
    );
    expect(rows).toHaveLength(0);
  });

  it('no puede insertar una fila a nombre de otra agencia', async () => {
    await expectDbError(
      () =>withTenant(ctx(A), (tx) =>
        tx.execute(sql`
          insert into vehicles (agency_id, brand, model, year, slug,
                                list_price_amount_cents, list_price_currency,
                                list_price_amount_base_cents)
          values (${B}, 'Fantasma', 'Inyectado', 2024, 'fantasma-inyectado',
                  1000000, 'USD', 1000000)
        `),
      ),
      /row-level security/i,
    );
  });

  it('no puede modificar un vehículo de otra agencia', async () => {
    await withTenant(ctx(A), (tx) =>
      tx.execute(sql`update vehicles set km = 1 where id = ${vehicleOfB}`),
    );

    const [after] = await dbAdmin.execute<{ km: number }>(
      sql`select km from vehicles where id = ${vehicleOfB}`,
    );
    expect(after!.km).not.toBe(1);
  });

  it('no puede borrar un vehículo de otra agencia', async () => {
    await withTenant(ctx(A), (tx) =>
      tx.execute(sql`delete from vehicles where id = ${vehicleOfB}`),
    );

    const rows = await dbAdmin.execute(sql`select 1 from vehicles where id = ${vehicleOfB}`);
    expect(rows).toHaveLength(1);
  });

  it('sin contexto de agencia no se ve nada: las políticas fallan cerradas', async () => {
    const rows = await withTenant({ ...ctx(A), agencyId: '' }, (tx) =>
      tx.execute(sql`select id from vehicles`),
    );
    expect(rows).toHaveLength(0);
  });

  it('el aislamiento alcanza a la proyección del catálogo público', async () => {
    const rows = await withTenant(ctx(A), (tx) =>
      tx.execute<{ agency_id: string }>(sql`select agency_id from vehicle_public_view`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.agency_id === A)).toBe(true);
  });

  it('solo ve usuarios que comparten membresía con su agencia', async () => {
    const rows = await withTenant(ctx(A), (tx) =>
      tx.execute<{ id: string }>(sql`select id from users`),
    );
    expect(rows.some((r) => r.id === userOfB)).toBe(false);
  });

  it('la contabilidad de otra agencia tampoco se filtra', async () => {
    const rows = await withTenant(ctx(A), (tx) =>
      tx.execute<{ agency_id: string }>(sql`select agency_id from vehicle_financials`),
    );
    expect(rows.every((r) => r.agency_id === A)).toBe(true);
  });
});

describe('append-only', () => {
  it('el timeline no se puede editar', async () => {
    await expectDbError(
      () =>withTenant(ctx(A), (tx) =>
        tx.execute(sql`update vehicle_events set type = 'NOTE_ADDED' where agency_id = ${A}`),
      ),
      /permission denied/i,
    );
  });

  it('el timeline no se puede borrar', async () => {
    await expectDbError(
      () =>withTenant(ctx(A), (tx) => tx.execute(sql`delete from vehicle_events where agency_id = ${A}`)),
      /permission denied/i,
    );
  });

  it('pero sí se pueden agregar eventos', async () => {
    const [vehicle] = await dbAdmin.execute<{ id: string }>(
      sql`select id from vehicles where agency_id = ${A} limit 1`,
    );

    const inserted = await withTenant(ctx(A), (tx) =>
      tx.execute<{ id: string }>(sql`
        insert into vehicle_events (agency_id, vehicle_id, type, source, payload)
        values (${A}, ${vehicle!.id}, 'NOTE_ADDED', 'WEB', '{"nota":"test"}'::jsonb)
        returning id
      `),
    );
    expect(inserted).toHaveLength(1);

    await dbAdmin.execute(sql`delete from vehicle_events where id = ${inserted[0]!.id}`);
  });

  it('la auditoría tampoco se edita', async () => {
    await expectDbError(
      () =>withTenant(ctx(A), (tx) => tx.execute(sql`update audit_log set action = 'x'`)),
      /permission denied/i,
    );
  });
});

describe('facturación', () => {
  it('una agencia no puede tocar su propia suscripción: eso lo escriben los webhooks', async () => {
    await expectDbError(
      () =>withTenant(ctx(A), (tx) =>
        tx.execute(sql`update subscriptions set status = 'ACTIVE' where agency_id = ${A}`),
      ),
      /permission denied/i,
    );
  });

  it('pero sí puede leerla, para mostrar su propio estado de cuenta', async () => {
    const rows = await withTenant(ctx(A), (tx) =>
      tx.execute<{ agency_id: string }>(sql`select agency_id from subscriptions`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agency_id).toBe(A);
  });
});

describe('panel de plataforma', () => {
  it('ve todas las agencias', async () => {
    const rows = await withPlatform(userOfB, (tx) =>
      tx.execute<{ id: string }>(sql`select id from agencies`),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(A);
    expect(ids).toContain(B);
  });

  it('no tiene acceso operativo: no puede leer precios ni descripciones', async () => {
    await expectDbError(
      () =>withPlatform(userOfB, (tx) =>
        tx.execute(sql`select list_price_amount_cents from vehicles limit 1`),
      ),
      /permission denied/i,
    );
  });

  it('sí puede contar unidades por estado, que es lo que necesita para métricas', async () => {
    const rows = await withPlatform(userOfB, (tx) =>
      tx.execute<{ status: string; n: number }>(
        sql`select status::text, count(*)::int as n from vehicles group by status`,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('no puede leer los leads de una agencia', async () => {
    await expectDbError(
      () =>withPlatform(userOfB, (tx) => tx.execute(sql`select name from leads limit 1`)),
      /permission denied/i,
    );
  });
});
