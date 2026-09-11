import {
  and,
  asc,
  count,
  dbAdmin,
  eq,
  ne,
  schema,
  withTenant,
  type Role,
  type TenantCtx,
} from '@cuasar/db';
import { z } from 'zod';
import { assertSeatAvailable, entitlementsFor } from '../entitlements';
import { fail, ok, type Result } from '../errors';
import { can } from '../permissions';
import { enqueue } from './outbox';

const { agencies, memberships, plans, subscriptions, users } = schema;

/**
 * El equipo de una agencia.
 *
 * Los asientos se validan acá y en el login. Una agencia que baja de plan no
 * puede quedar con gente de más adentro, y una invitación no puede crear un
 * asiento que nadie está pagando.
 */

export const ROLES: Role[] = ['OWNER', 'ADMIN', 'SALES', 'VIEWER'];

export type MemberRow = {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string;
  role: Role;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  invitedAt: Date;
  activatedAt: Date | null;
  isMe: boolean;
};

export async function listMembers(ctx: TenantCtx): Promise<MemberRow[]> {
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        name: users.name,
        email: users.email,
        role: memberships.role,
        status: memberships.status,
        invitedAt: memberships.invitedAt,
        activatedAt: memberships.activatedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(ne(memberships.status, 'DISABLED'))
      .orderBy(asc(memberships.role), asc(users.email)),
  );

  return rows.map((r) => ({
    ...r,
    role: r.role as Role,
    status: r.status as MemberRow['status'],
    isMe: r.userId === ctx.userId,
  }));
}

export type SeatState = {
  used: number;
  limit: number;
  available: number;
  includedSeats: number;
  seatsPurchased: number;
  extraSeatPriceCents: bigint;
  currency: string;
};

/** Cuántos asientos hay, cuántos se usan y cuánto cuesta el siguiente. */
export async function getSeatState(ctx: TenantCtx): Promise<SeatState> {
  const [row] = await dbAdmin
    .select({
      includedSeats: plans.includedSeats,
      extraSeatPriceCents: plans.extraSeatPriceCents,
      currency: plans.currency,
      seatsPurchased: subscriptions.seatsPurchased,
      agencyStatus: agencies.status,
      subscriptionStatus: subscriptions.status,
      gracePeriodEndsAt: subscriptions.gracePeriodEndsAt,
    })
    .from(agencies)
    .leftJoin(subscriptions, eq(subscriptions.agencyId, agencies.id))
    .leftJoin(plans, eq(plans.code, subscriptions.planCode))
    .where(eq(agencies.id, ctx.agencyId))
    .limit(1);

  const used = await countActiveMembers(ctx.agencyId);

  const entitlements = entitlementsFor({
    agencyStatus: row?.agencyStatus ?? 'ACTIVE',
    subscriptionStatus: row?.subscriptionStatus ?? 'TRIALING',
    gracePeriodEndsAt: row?.gracePeriodEndsAt ?? null,
    includedSeats: row?.includedSeats ?? 5,
    seatsPurchased: row?.seatsPurchased ?? 5,
    activeMembers: used,
  });

  return {
    used,
    limit: entitlements.seatLimit,
    available: entitlements.seatsAvailable,
    includedSeats: row?.includedSeats ?? 5,
    seatsPurchased: row?.seatsPurchased ?? 5,
    extraSeatPriceCents: row?.extraSeatPriceCents ?? 0n,
    currency: row?.currency ?? 'USD',
  };
}

/**
 * Una invitación pendiente ya ocupa un asiento.
 *
 * Si no contara, una agencia con el plan lleno podría invitar a diez personas
 * y quedarse con quince cuentas el día que todas entren.
 */
async function countActiveMembers(agencyId: string): Promise<number> {
  const [row] = await dbAdmin
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.agencyId, agencyId), ne(memberships.status, 'DISABLED')));

  return Number(row?.n ?? 0);
}

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email('Revisá el mail.'),
  role: z.enum(['ADMIN', 'SALES', 'VIEWER']),
});

/**
 * Invita a alguien por mail.
 *
 * Se crea la fila de usuario con un `externalId` provisorio; cuando esa
 * persona entra por primera vez con ese mail, el login la enlaza con su
 * cuenta real (ver `linkPendingInvitations`). Así la invitación funciona sin
 * depender de que el mail haya llegado.
 */
export async function inviteMember(
  ctx: TenantCtx,
  raw: unknown,
): Promise<Result<{ userId: string; email: string }>> {
  if (!can(ctx.role, 'member:manage')) {
    return fail('FORBIDDEN', 'Solo un administrador puede invitar gente.');
  }

  const parsed = inviteInput.safeParse(raw);
  if (!parsed.success) {
    return fail('VALIDATION', parsed.error.issues[0]?.message ?? 'Revisá los datos.');
  }
  const { email, role } = parsed.data;

  const seats = await getSeatState(ctx);
  const check = assertSeatAvailable({
    agencyStatus: 'ACTIVE',
    subscriptionStatus: 'ACTIVE',
    gracePeriodEndsAt: null,
    includedSeats: seats.includedSeats,
    seatsPurchased: seats.seatsPurchased,
    activeMembers: seats.used,
  });
  if (!check.ok) return check as Result<{ userId: string; email: string }>;

  // El usuario puede existir ya: la misma persona puede trabajar en dos
  // agencias, y es una sola cuenta.
  const [existing] = await dbAdmin.select().from(users).where(eq(users.email, email)).limit(1);

  const user =
    existing ??
    (
      await dbAdmin
        .insert(users)
        .values({ email, externalId: `invite:${email}` })
        .returning()
    )[0]!;

  const [alreadyMember] = await dbAdmin
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.agencyId, ctx.agencyId), eq(memberships.userId, user.id)))
    .limit(1);

  if (alreadyMember && alreadyMember.status !== 'DISABLED') {
    return fail('CONFLICT', 'Esa persona ya está en el equipo.');
  }

  return withTenant(ctx, async (tx) => {
    if (alreadyMember) {
      await tx
        .update(memberships)
        .set({ status: 'INVITED', role, invitedAt: new Date(), activatedAt: null })
        .where(eq(memberships.id, alreadyMember.id));
    } else {
      await tx
        .insert(memberships)
        .values({ agencyId: ctx.agencyId, userId: user.id, role, status: 'INVITED' });
    }

    await enqueue(tx, ctx.agencyId, 'member.invited', { userId: user.id });

    return ok({ userId: user.id, email });
  });
}

export async function changeMemberRole(
  ctx: TenantCtx,
  membershipId: string,
  role: Role,
): Promise<Result<true>> {
  if (!can(ctx.role, 'member:manage')) {
    return fail('FORBIDDEN', 'Solo un administrador cambia roles.');
  }

  return withTenant(ctx, async (tx) => {
    const [target] = await tx
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.id, membershipId))
      .limit(1);

    if (!target) return fail<true>('NOT_FOUND', 'Esa persona no está en el equipo.');

    // Una agencia sin dueño es una agencia que nadie puede administrar.
    if (target.role === 'OWNER' && role !== 'OWNER') {
      const owners = await countOwners(ctx.agencyId);
      if (owners <= 1) {
        return fail<true>('VALIDATION', 'La agencia tiene que tener al menos un dueño.');
      }
    }

    await tx.update(memberships).set({ role }).where(eq(memberships.id, membershipId));
    return ok(true as const);
  });
}

export async function removeMember(ctx: TenantCtx, membershipId: string): Promise<Result<true>> {
  if (!can(ctx.role, 'member:manage')) {
    return fail('FORBIDDEN', 'Solo un administrador saca gente del equipo.');
  }

  return withTenant(ctx, async (tx) => {
    const [target] = await tx
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.id, membershipId))
      .limit(1);

    if (!target) return fail<true>('NOT_FOUND', 'Esa persona no está en el equipo.');

    if (target.userId === ctx.userId) {
      return fail<true>('VALIDATION', 'No podés sacarte a vos mismo.');
    }
    if (target.role === 'OWNER' && (await countOwners(ctx.agencyId)) <= 1) {
      return fail<true>('VALIDATION', 'La agencia tiene que tener al menos un dueño.');
    }

    // Se deshabilita, no se borra: los eventos del timeline y las ventas
    // apuntan a esta persona, y el historial tiene que seguir nombrándola.
    await tx
      .update(memberships)
      .set({ status: 'DISABLED' })
      .where(eq(memberships.id, membershipId));

    return ok(true as const);
  });
}

async function countOwners(agencyId: string): Promise<number> {
  const [row] = await dbAdmin
    .select({ n: count() })
    .from(memberships)
    .where(
      and(
        eq(memberships.agencyId, agencyId),
        eq(memberships.role, 'OWNER'),
        ne(memberships.status, 'DISABLED'),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Enlaza las invitaciones pendientes con la cuenta real de quien entra.
 *
 * Corre en el login. Busca por mail una fila creada por una invitación y le
 * pone el id de identidad de verdad; las membresías que colgaban de ella
 * pasan a activas. Si la persona ya tenía cuenta, se fusionan las dos.
 */
export async function linkPendingInvitations(
  externalId: string,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();

  const [pending] = await dbAdmin
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, normalized), eq(users.externalId, `invite:${normalized}`)))
    .limit(1);

  if (!pending) return null;

  await dbAdmin.update(users).set({ externalId }).where(eq(users.id, pending.id));

  await dbAdmin
    .update(memberships)
    .set({ status: 'ACTIVE', activatedAt: new Date() })
    .where(and(eq(memberships.userId, pending.id), eq(memberships.status, 'INVITED')));

  return pending.id;
}

/** Activa las invitaciones de alguien que ya tenía cuenta. */
export async function activateInvitations(userId: string): Promise<void> {
  await dbAdmin
    .update(memberships)
    .set({ status: 'ACTIVE', activatedAt: new Date() })
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'INVITED')));
}
