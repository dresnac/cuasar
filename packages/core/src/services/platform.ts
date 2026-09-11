import { dbAdmin, eq, schema, sql, withPlatform } from '@cuasar/db';
import { fail, ok, type Result } from '../errors';

const { agencies, auditLog, platformAdmins, users } = schema;

/**
 * El panel de la plataforma.
 *
 * Corre fuera de todo contexto de agencia, con el rol `app_platform`: ve
 * cuentas, suscripciones y conteos, no datos operativos. Los GRANT por
 * columna sobre `vehicles` son lo que hace que un moderador pueda contar
 * unidades por estado sin poder leer un precio de compra.
 *
 * Todo lo que hace un moderador queda en `audit_log`, que es append-only.
 */

export type PlatformAdmin = { userId: string; level: 'SUPPORT' | 'ADMIN'; name: string | null };

export async function getPlatformAdmin(userId: string): Promise<PlatformAdmin | null> {
  const [row] = await dbAdmin
    .select({ userId: platformAdmins.userId, level: platformAdmins.level, name: users.name })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .where(eq(platformAdmins.userId, userId))
    .limit(1);

  return row ? { ...row, level: row.level as 'SUPPORT' | 'ADMIN' } : null;
}

export type PlatformMetrics = {
  agencies: { total: number; active: number; suspended: number; cancelled: number };
  subscriptions: { active: number; trialing: number; pastDue: number; cancelled: number };
  /** Ingreso mensual recurrente, en USD: es la moneda del plan. */
  mrrCents: bigint;
  users: number;
  vehicles: { total: number; published: number; sold: number };
  leadsLast30: number;
  failedMessages: number;
};

export async function getPlatformMetrics(actorUserId: string): Promise<PlatformMetrics> {
  return withPlatform(actorUserId, async (tx) => {
    const [agencyRow] = await tx.execute<Record<string, unknown>>(sql`
      select
        count(*)::int                                        as total,
        count(*) filter (where status = 'ACTIVE')::int       as active,
        count(*) filter (where status = 'SUSPENDED')::int    as suspended,
        count(*) filter (where status = 'CANCELLED')::int    as cancelled
      from agencies
    `);

    const [subscriptionRow] = await tx.execute<Record<string, unknown>>(sql`
      select
        count(*) filter (where s.status = 'ACTIVE')::int    as active,
        count(*) filter (where s.status = 'TRIALING')::int  as trialing,
        count(*) filter (where s.status = 'PAST_DUE')::int  as past_due,
        count(*) filter (where s.status = 'CANCELLED')::int as cancelled,
        coalesce(sum(
          case when s.status in ('ACTIVE','PAST_DUE')
               then p.price_cents
                    + greatest(0, s.seats_purchased - p.included_seats) * p.extra_seat_price_cents
               else 0 end
        ), 0) as mrr
      from subscriptions s
      join plans p on p.code = s.plan_code
    `);

    const [vehicleRow] = await tx.execute<Record<string, unknown>>(sql`
      select
        count(*)::int                                     as total,
        count(*) filter (where status = 'PUBLICADO')::int as published,
        count(*) filter (where status = 'VENDIDO')::int   as sold
      from vehicles
    `);

    const [userRow] = await tx.execute<Record<string, unknown>>(
      sql`select count(distinct user_id)::int as n from memberships where status <> 'DISABLED'`,
    );

    // Los leads y la cola no están en los GRANT de `app_platform` —son datos
    // de la agencia— así que estos dos conteos van con el rol dueño. Son
    // números agregados: no exponen ninguna fila.
    const [leadRow] = await dbAdmin.execute<{ n: number }>(
      sql`select count(*)::int as n from leads where created_at > now() - interval '30 days'`,
    );
    const [outboxRow] = await dbAdmin.execute<{ n: number }>(
      sql`select count(*)::int as n from outbox where status = 'FAILED'`,
    );

    const num = (v: unknown) => Number(v ?? 0);

    return {
      agencies: {
        total: num(agencyRow?.total),
        active: num(agencyRow?.active),
        suspended: num(agencyRow?.suspended),
        cancelled: num(agencyRow?.cancelled),
      },
      subscriptions: {
        active: num(subscriptionRow?.active),
        trialing: num(subscriptionRow?.trialing),
        pastDue: num(subscriptionRow?.past_due),
        cancelled: num(subscriptionRow?.cancelled),
      },
      mrrCents: BigInt(String(subscriptionRow?.mrr ?? '0')),
      users: num(userRow?.n),
      vehicles: {
        total: num(vehicleRow?.total),
        published: num(vehicleRow?.published),
        sold: num(vehicleRow?.sold),
      },
      leadsLast30: num(leadRow?.n),
      failedMessages: num(outboxRow?.n),
    };
  });
}

export type AgencyRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  baseCurrency: string;
  createdAt: Date;
  subscriptionStatus: string | null;
  provider: string | null;
  currentPeriodEnd: Date | null;
  seatsPurchased: number | null;
  members: number;
  vehicles: number;
};

export async function listAgencies(actorUserId: string): Promise<AgencyRow[]> {
  return withPlatform(actorUserId, async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      select
        a.id, a.name, a.slug, a.status, a.base_currency, a.created_at,
        s.status as subscription_status, s.provider, s.current_period_end, s.seats_purchased,
        (select count(*)::int from memberships m
          where m.agency_id = a.id and m.status <> 'DISABLED') as members,
        (select count(*)::int from vehicles v where v.agency_id = a.id) as vehicles
      from agencies a
      left join subscriptions s
        on s.agency_id = a.id and s.status <> 'CANCELLED'
      order by a.created_at desc
    `);

    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      slug: String(r.slug),
      status: String(r.status),
      baseCurrency: String(r.base_currency),
      createdAt: new Date(r.created_at as string),
      subscriptionStatus: (r.subscription_status as string) ?? null,
      provider: (r.provider as string) ?? null,
      currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end as string) : null,
      seatsPurchased: r.seats_purchased ? Number(r.seats_purchased) : null,
      members: Number(r.members ?? 0),
      vehicles: Number(r.vehicles ?? 0),
    }));
  });
}

export type AgencyStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

/**
 * Alta y baja de una agencia.
 *
 * Suspender no borra nada: la gente deja de entrar y el trigger de la
 * proyección le vacía el catálogo público, pero el stock, la contabilidad y
 * el historial quedan intactos. Reactivar la devuelve entera.
 */
export async function setAgencyStatus(
  actorUserId: string,
  agencyId: string,
  status: AgencyStatus,
  reason: string,
): Promise<Result<true>> {
  const admin = await getPlatformAdmin(actorUserId);
  if (!admin) return fail('FORBIDDEN', 'No sos moderador de la plataforma.');
  if (admin.level !== 'ADMIN') {
    return fail('FORBIDDEN', 'Dar de alta o de baja una agencia requiere nivel administrador.');
  }
  if (!reason.trim()) {
    return fail('VALIDATION', 'Escribí el motivo: queda en la auditoría.');
  }

  return withPlatform(actorUserId, async (tx) => {
    const [before] = await tx
      .select({ status: agencies.status, name: agencies.name })
      .from(agencies)
      .where(eq(agencies.id, agencyId))
      .limit(1);

    if (!before) return fail<true>('NOT_FOUND', 'La agencia no existe.');

    await tx.update(agencies).set({ status }).where(eq(agencies.id, agencyId));

    await tx.insert(auditLog).values({
      agencyId,
      actorUserId,
      action: `agency.status.${status.toLowerCase()}`,
      targetType: 'agency',
      targetId: agencyId,
      payload: { from: before.status, to: status, reason: reason.trim(), name: before.name },
    });

    return ok(true as const);
  });
}

export type AuditRow = {
  id: string;
  action: string;
  occurredAt: Date;
  actorName: string | null;
  agencyName: string | null;
  payload: Record<string, unknown>;
};

export async function listAuditLog(actorUserId: string, limit = 50): Promise<AuditRow[]> {
  return withPlatform(actorUserId, async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      select l.id, l.action, l.occurred_at, l.payload,
             u.name as actor_name, a.name as agency_name
      from audit_log l
      left join users u on u.id = l.actor_user_id
      left join agencies a on a.id = l.agency_id
      order by l.occurred_at desc
      limit ${limit}
    `);

    return rows.map((r) => ({
      id: String(r.id),
      action: String(r.action),
      occurredAt: new Date(r.occurred_at as string),
      actorName: (r.actor_name as string) ?? null,
      agencyName: (r.agency_name as string) ?? null,
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));
  });
}
