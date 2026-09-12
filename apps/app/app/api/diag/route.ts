import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { dbAdmin, sql, withTenant } from '@cuasar/db';

/**
 * Diagnóstico temporal de latencia. Protegido con CRON_SECRET.
 *
 * Existe para dejar de adivinar por qué una acción tarda tres segundos:
 * mide por separado el costo de abrir la conexión, el de un viaje simple, el
 * de una transacción con contexto de tenant, y el de resolver la sesión de
 * Clerk. Se borra cuando el número aparezca.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const timings: Record<string, number> = {};
  const time = async (label: string, fn: () => Promise<unknown>) => {
    const start = performance.now();
    try {
      await fn();
    } catch (error) {
      timings[`${label}:error`] = 1;
      console.warn(`[diag] ${label}`, error);
    }
    timings[label] = Math.round(performance.now() - start);
  };

  // Primer viaje: incluye abrir la conexión y el handshake TLS.
  await time('1-primer-select', () => dbAdmin.execute(sql`select 1`));
  await time('2-select-caliente', () => dbAdmin.execute(sql`select 1`));
  await time('3-select-caliente', () => dbAdmin.execute(sql`select 1`));

  const [agency] = await dbAdmin.execute<{ id: string }>(
    sql`select id from agencies order by created_at limit 1`,
  );
  const [member] = await dbAdmin.execute<{ user_id: string }>(
    sql`select user_id from memberships where agency_id = ${agency!.id} limit 1`,
  );
  const ctx = { agencyId: agency!.id, userId: member!.user_id, role: 'OWNER' as const };

  // Una transacción con contexto: es lo que paga cada llamada de dominio.
  await time('4-withTenant-vacio', () =>
    withTenant(ctx, (tx) => tx.execute(sql`select 1`)),
  );
  await time('5-withTenant-vacio', () =>
    withTenant(ctx, (tx) => tx.execute(sql`select 1`)),
  );
  await time('6-withTenant-listado', () =>
    withTenant(ctx, (tx) =>
      tx.execute(sql`select id, brand from vehicles order by created_at desc limit 24`),
    ),
  );

  // Diez transacciones seguidas: el orden de magnitud de una acción real.
  await time('7-diez-withTenant', async () => {
    for (let i = 0; i < 10; i++) {
      await withTenant(ctx, (tx) => tx.execute(sql`select 1`));
    }
  });

  await time('8-clerk-auth', () => auth());

  return NextResponse.json({
    region: process.env.VERCEL_REGION ?? null,
    timings,
  });
}
