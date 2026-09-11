import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, currentUser } from '@clerk/nextjs/server';
import { and, asc, dbAdmin, eq, schema, type Role, type TenantCtx } from '@cuasar/db';
import { entitlementsFor, type AccessLevel } from '@cuasar/core';

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

  if (existing) return existing;

  // Primer ingreso: espejamos el usuario de Clerk. No guardamos credenciales.
  const clerkUser = await currentUser();
  const [created] = await dbAdmin
    .insert(users)
    .values({
      externalId: clerkId,
      email: clerkUser?.primaryEmailAddress?.emailAddress ?? `${clerkId}@sin-email.local`,
      name:
        [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') ||
        clerkUser?.username ||
        null,
      avatarUrl: clerkUser?.imageUrl ?? null,
    })
    .onConflictDoUpdate({
      target: users.externalId,
      set: { email: clerkUser?.primaryEmailAddress?.emailAddress ?? 'sin-email' },
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

export const myMemberships = cache(async (): Promise<Membership[]> => {
  const user = await currentLocalUser();

  return dbAdmin
    .select({
      agencyId: agencies.id,
      agencyName: agencies.name,
      agencySlug: agencies.slug,
      baseCurrency: agencies.baseCurrency,
      timezone: agencies.timezone,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(agencies, eq(agencies.id, memberships.agencyId))
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'ACTIVE')))
    .orderBy(asc(agencies.name));
});

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
  const all = await myMemberships();

  if (all.length === 0) redirect('/alta-agencia');

  const jar = await cookies();
  const preferred = jar.get(ACTIVE_AGENCY_COOKIE)?.value;
  const agency = all.find((m) => m.agencyId === preferred) ?? all[0]!;

  const access = await accessLevelFor(agency.agencyId);
  if (access === 'BLOCKED') redirect('/cuenta-bloqueada');

  return {
    ctx: { agencyId: agency.agencyId, userId: user.id, role: agency.role },
    user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl },
    agency,
    memberships: all,
    access,
  };
});

async function accessLevelFor(agencyId: string): Promise<AccessLevel> {
  const [row] = await dbAdmin
    .select({
      agencyStatus: agencies.status,
      subscriptionStatus: subscriptions.status,
      gracePeriodEndsAt: subscriptions.gracePeriodEndsAt,
      seatsPurchased: subscriptions.seatsPurchased,
      includedSeats: plans.includedSeats,
    })
    .from(agencies)
    .leftJoin(subscriptions, eq(subscriptions.agencyId, agencies.id))
    .leftJoin(plans, eq(plans.code, subscriptions.planCode))
    .where(eq(agencies.id, agencyId))
    .limit(1);

  if (!row) return 'BLOCKED';

  return entitlementsFor({
    agencyStatus: row.agencyStatus,
    subscriptionStatus: row.subscriptionStatus ?? 'TRIALING',
    gracePeriodEndsAt: row.gracePeriodEndsAt,
    includedSeats: row.includedSeats ?? 5,
    seatsPurchased: row.seatsPurchased ?? 5,
    activeMembers: 0,
  }).backoffice;
}

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
