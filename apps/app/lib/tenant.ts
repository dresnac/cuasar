import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, currentUser } from '@clerk/nextjs/server';
import { and, asc, dbAdmin, eq, ne, schema, type Role, type TenantCtx } from '@cuasar/db';
import { entitlementsFor, type AccessLevel } from '@cuasar/core';
import { activateInvitations, linkPendingInvitations } from '@cuasar/core/services';

const { users, memberships, agencies, subscriptions, plans } = schema;

const ACTIVE_AGENCY_COOKIE = 'cuasar_agencia';

/**
 * Clerk resuelve identidad; la agencia, el rol y los asientos los resuelve
 * esta base. Es deliberado: las políticas RLS y la matriz de permisos
 * dependen de `memberships`, así que esa tabla tiene que ser la autoridad.
 * Dos fuentes de verdad sobre quién pertenece a qué es exactamente el tipo
 * de cosa que termina en una fuga de datos.
 */
export const currentLocalUser = cache(async () => {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/ingresar');

  const [existing] = await dbAdmin
    .select()
    .from(users)
    .where(eq(users.externalId, clerkId))
    .limit(1);

  // Las invitaciones pendientes se activan en `myMemberships`, que ya consulta
  // esa tabla. Hacerlo acá costaba un UPDATE en cada request del día para
  // atender un caso que ocurre una vez en la vida de cada usuario.
  if (existing) return existing;

  // Primer ingreso: espejamos el usuario de Clerk. No guardamos credenciales.
  const clerkUser = await currentUser();
  const email = clerkUser?.primaryEmailAddress?.emailAddress;

  // Si lo invitaron antes de que tuviera cuenta, la fila ya existe con un
  // externalId provisorio: se enlaza con la identidad real en vez de crear
  // un segundo usuario con el mismo mail.
  if (email) {
    const linkedId = await linkPendingInvitations(clerkId, email);
    if (linkedId) {
      const [linked] = await dbAdmin.select().from(users).where(eq(users.id, linkedId)).limit(1);
      if (linked) return linked;
    }
  }
  const [created] = await dbAdmin
    .insert(users)
    .values({
      externalId: clerkId,
      email: email ?? `${clerkId}@sin-email.local`,
      name:
        [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') ||
        clerkUser?.username ||
        null,
      avatarUrl: clerkUser?.imageUrl ?? null,
    })
    .onConflictDoUpdate({
      target: users.externalId,
      set: { email: email ?? 'sin-email' },
    })
    .returning();

  return created!;
});

export type Membership = {
  agencyId: string;
  agencyName: string;
  agencySlug: string;
  baseCurrency: string;
  timezone: string;
  role: Role;
};

type MembershipWithBilling = Membership & {
  agencyStatus: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  subscriptionStatus: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | null;
  gracePeriodEndsAt: Date | null;
  includedSeats: number | null;
  seatsPurchased: number | null;
  pending: boolean;
};

/**
 * Las agencias de esta persona, con el estado de cobro de cada una.
 *
 * Una sola consulta y no dos: el nivel de acceso depende de la suscripción y
 * del plan, y traerlo en el mismo join ahorra un viaje a la base en cada
 * request. Con la base a 150 ms de la función, cada viaje se nota.
 */
const myMembershipRows = cache(async (): Promise<MembershipWithBilling[]> => {
  const user = await currentLocalUser();

  const rows = await dbAdmin
    .select({
      agencyId: agencies.id,
      agencyName: agencies.name,
      agencySlug: agencies.slug,
      baseCurrency: agencies.baseCurrency,
      timezone: agencies.timezone,
      role: memberships.role,
      status: memberships.status,
      agencyStatus: agencies.status,
      subscriptionStatus: subscriptions.status,
      gracePeriodEndsAt: subscriptions.gracePeriodEndsAt,
      includedSeats: plans.includedSeats,
      seatsPurchased: subscriptions.seatsPurchased,
    })
    .from(memberships)
    .innerJoin(agencies, eq(agencies.id, memberships.agencyId))
    .leftJoin(subscriptions, eq(subscriptions.agencyId, agencies.id))
    .leftJoin(plans, eq(plans.code, subscriptions.planCode))
    .where(and(eq(memberships.userId, user.id), ne(memberships.status, 'DISABLED')))
    .orderBy(asc(agencies.name));

  // Si la invitaron antes de que tuviera cuenta, esta es la primera vez que la
  // vemos entrar: se activa acá, una sola vez, y no en cada request.
  if (rows.some((r) => r.status === 'INVITED')) {
    await activateInvitations(user.id);
  }

  return rows.map((r) => ({
    agencyId: r.agencyId,
    agencyName: r.agencyName,
    agencySlug: r.agencySlug,
    baseCurrency: r.baseCurrency,
    timezone: r.timezone,
    role: r.role as Role,
    agencyStatus: r.agencyStatus,
    subscriptionStatus: r.subscriptionStatus,
    gracePeriodEndsAt: r.gracePeriodEndsAt,
    includedSeats: r.includedSeats,
    seatsPurchased: r.seatsPurchased,
    pending: r.status === 'INVITED',
  }));
});

export const myMemberships = cache(async (): Promise<Membership[]> =>
  (await myMembershipRows()).map(({ agencyId, agencyName, agencySlug, baseCurrency, timezone, role }) => ({
    agencyId,
    agencyName,
    agencySlug,
    baseCurrency,
    timezone,
    role,
  })),
);

export type Session = {
  ctx: TenantCtx;
  user: { id: string; name: string | null; email: string; avatarUrl: string | null };
  agency: Membership;
  memberships: Membership[];
  access: AccessLevel;
};

/**
 * El contexto que acompaña a toda operación. Si el usuario no pertenece a
 * ninguna agencia va a onboarding; si su suscripción está bloqueada, a la
 * pantalla de cuenta. Ninguna pantalla decide esto por su cuenta.
 */
export const requireSession = cache(async (): Promise<Session> => {
  const user = await currentLocalUser();
  const rows = await myMembershipRows();

  if (rows.length === 0) redirect('/alta-agencia');

  const jar = await cookies();
  const preferred = jar.get(ACTIVE_AGENCY_COOKIE)?.value;
  const row = rows.find((m) => m.agencyId === preferred) ?? rows[0]!;

  const access = entitlementsFor({
    agencyStatus: row.agencyStatus,
    subscriptionStatus: row.subscriptionStatus ?? 'TRIALING',
    gracePeriodEndsAt: row.gracePeriodEndsAt,
    includedSeats: row.includedSeats ?? 5,
    seatsPurchased: row.seatsPurchased ?? 5,
    activeMembers: 0,
  }).backoffice;

  if (access === 'BLOCKED') redirect('/cuenta-bloqueada');

  const { agencyId, agencyName, agencySlug, baseCurrency, timezone, role } = row;

  return {
    ctx: { agencyId, userId: user.id, role },
    user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl },
    agency: { agencyId, agencyName, agencySlug, baseCurrency, timezone, role },
    memberships: await myMemberships(),
    access,
  };
});

export async function switchAgency(agencyId: string) {
  const all = await myMemberships();
  if (!all.some((m) => m.agencyId === agencyId)) return;

  const jar = await cookies();
  jar.set(ACTIVE_AGENCY_COOKIE, agencyId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** El equipo de la agencia activa, para asignar ventas y turnos. */
export const agencyTeam = cache(async (agencyId: string) => {
  const rows = await dbAdmin
    .select({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.agencyId, agencyId), eq(memberships.status, 'ACTIVE')))
    .orderBy(asc(users.name));

  return rows.map((r) => ({ id: r.id, name: r.name ?? r.email }));
});
