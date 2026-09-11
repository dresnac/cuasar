import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type Role = 'OWNER' | 'ADMIN' | 'SALES' | 'VIEWER';

/** Contexto que acompaña a toda operación de dominio. */
export type TenantCtx = {
  agencyId: string;
  userId: string;
  role: Role;
  requestId?: string;
};

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está definida');
  return url;
}

const globalForDb = globalThis as unknown as { __cuasarSql?: postgres.Sql };

const client =
  globalForDb.__cuasarSql ??
  postgres(connectionString(), {
    // El pooler de Neon está en modo transaction: los prepared statements
    // no sobreviven entre requests.
    prepare: false,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== 'production') globalForDb.__cuasarSql = client;

/**
 * Conexión con el rol dueño: bypassea RLS.
 *
 * Solo para migraciones, seeds, webhooks de cobro y el worker de outbox —
 * todo lo que ocurre fuera de una sesión de usuario. Cualquier cosa que
 * responda a un request de agencia va por `withTenant`.
 */
export const dbAdmin: Database = drizzle(client, { schema, casing: 'snake_case' });

/**
 * Abre una transacción acotada a una agencia.
 *
 * Setea el contexto y baja privilegios a `app_tenant`, que no es dueño de
 * las tablas y por lo tanto sí queda sujeto a RLS. Aunque un query adentro
 * se olvide del `where agency_id`, Postgres no devuelve filas de otro tenant.
 * Ambos settings son LOCAL: mueren con la transacción.
 */
export async function withTenant<T>(
  ctx: TenantCtx,
  fn: (tx: Tx, ctx: TenantCtx) => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.agency_id', ${ctx.agencyId}, true)`);
    await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
    await tx.execute(sql`set local role app_tenant`);
    return fn(tx, ctx);
  });
}

/**
 * Transacción del panel de plataforma. Corre fuera de todo contexto de
 * agencia: ve cuentas, suscripciones y métricas agregadas, no datos
 * operativos. Todo acceso a una agencia concreta pasa por impersonación
 * explícita, que deja registro en `audit_log`.
 */
export async function withPlatform<T>(
  actorUserId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${actorUserId}, true)`);
    await tx.execute(sql`set local role app_platform`);
    return fn(tx);
  });
}

export { client as pgClient };

/**
 * Transacción del sitio público.
 *
 * La agencia se conoce (salió del dominio), pero no hay usuario. El rol
 * `app_public` solo puede leer el catálogo y dejar una consulta: no alcanza
 * la tabla `vehicles` —donde vive el precio de compra— ni puede releer los
 * leads que él mismo dejó. Es la única parte del sistema expuesta a internet
 * sin autenticación, así que sus privilegios se definen por lo que necesita,
 * no por lo que le sobra.
 */
export async function withPublicAgency<T>(
  agencyId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.agency_id', ${agencyId}, true)`);
    await tx.execute(sql`set local role app_public`);
    return fn(tx);
  });
}
