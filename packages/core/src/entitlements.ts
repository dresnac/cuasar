import { fail, ok, type Result } from './errors';

/**
 * Qué puede hacer una agencia según el estado de su suscripción.
 *
 * Un solo lugar decide esto. Si cada pantalla resolviera por su cuenta qué
 * hacer con un PAST_DUE, la plataforma terminaría con una docena de
 * criterios distintos y alguno dejaría pasar algo que no debía.
 */
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export type AgencyState = {
  agencyStatus: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  subscriptionStatus: SubscriptionStatus;
  gracePeriodEndsAt: Date | null;
  includedSeats: number;
  seatsPurchased: number;
  activeMembers: number;
};

export type AccessLevel = 'FULL' | 'READ_ONLY' | 'BLOCKED';

export type Entitlements = {
  backoffice: AccessLevel;
  /** Si es false, el catálogo público de la agencia se despublica. */
  publicSiteVisible: boolean;
  seatLimit: number;
  seatsAvailable: number;
};

export function entitlementsFor(state: AgencyState, now = new Date()): Entitlements {
  const seatLimit = Math.max(state.includedSeats, state.seatsPurchased);
  const seatsAvailable = Math.max(0, seatLimit - state.activeMembers);

  const base = { seatLimit, seatsAvailable };

  if (state.agencyStatus !== 'ACTIVE' || state.subscriptionStatus === 'CANCELLED') {
    // Los datos se retienen 90 días antes de purgarse, pero nadie entra
    // y el sitio público deja de existir.
    return { ...base, backoffice: 'BLOCKED', publicSiteVisible: false };
  }

  if (state.subscriptionStatus === 'PAST_DUE') {
    const inGrace = state.gracePeriodEndsAt !== null && now < state.gracePeriodEndsAt;
    return {
      ...base,
      backoffice: inGrace ? 'FULL' : 'READ_ONLY',
      // El sitio público sigue arriba: cortarlo le cuesta ventas a quien
      // probablemente esté por pagar, y no ayuda a cobrar.
      publicSiteVisible: true,
    };
  }

  return { ...base, backoffice: 'FULL', publicSiteVisible: true };
}

/** Se valida en la invitación Y en el login: bajar de plan no puede dejar asientos de más. */
export function assertSeatAvailable(state: AgencyState): Result<number> {
  const { seatsAvailable, seatLimit } = entitlementsFor(state);

  if (seatsAvailable <= 0) {
    return fail(
      'QUOTA_EXCEEDED',
      `El plan incluye ${seatLimit} usuarios y ya están todos ocupados.`,
      { seatLimit, activeMembers: state.activeMembers },
    );
  }
  return ok(seatsAvailable);
}

export function assertCanWrite(state: AgencyState, now = new Date()): Result<true> {
  const level = entitlementsFor(state, now).backoffice;

  if (level === 'BLOCKED') {
    return fail('SUBSCRIPTION_INACTIVE', 'La cuenta está dada de baja.');
  }
  if (level === 'READ_ONLY') {
    return fail(
      'SUBSCRIPTION_INACTIVE',
      'La suscripción tiene un pago pendiente. La cuenta está en modo lectura.',
    );
  }
  return ok(true);
}
