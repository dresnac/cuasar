import { describe, expect, it } from 'vitest';
import { assertSeatAvailable, entitlementsFor } from '../src/entitlements';

const base = {
  agencyStatus: 'ACTIVE' as const,
  subscriptionStatus: 'ACTIVE' as const,
  gracePeriodEndsAt: null,
  includedSeats: 5,
  seatsPurchased: 5,
  activeMembers: 3,
};

describe('acceso según suscripción', () => {
  it('activa: todo habilitado', () => {
    const e = entitlementsFor(base);
    expect(e.backoffice).toBe('FULL');
    expect(e.publicSiteVisible).toBe(true);
    expect(e.seatsAvailable).toBe(2);
  });

  it('PAST_DUE dentro del período de gracia sigue escribiendo', () => {
    const e = entitlementsFor({
      ...base,
      subscriptionStatus: 'PAST_DUE',
      gracePeriodEndsAt: new Date('2026-09-20'),
    }, new Date('2026-09-15'));
    expect(e.backoffice).toBe('FULL');
  });

  it('PAST_DUE vencida la gracia pasa a lectura, pero el sitio público sigue arriba', () => {
    const e = entitlementsFor({
      ...base,
      subscriptionStatus: 'PAST_DUE',
      gracePeriodEndsAt: new Date('2026-09-01'),
    }, new Date('2026-09-15'));
    expect(e.backoffice).toBe('READ_ONLY');
    expect(e.publicSiteVisible).toBe(true);
  });

  it('cancelada bloquea y despublica', () => {
    const e = entitlementsFor({ ...base, subscriptionStatus: 'CANCELLED' });
    expect(e.backoffice).toBe('BLOCKED');
    expect(e.publicSiteVisible).toBe(false);
  });

  it('agencia suspendida por la plataforma queda bloqueada aunque pague', () => {
    const e = entitlementsFor({ ...base, agencyStatus: 'SUSPENDED' });
    expect(e.backoffice).toBe('BLOCKED');
  });
});

describe('asientos', () => {
  it('el límite es el mayor entre incluidos y comprados', () => {
    expect(entitlementsFor({ ...base, seatsPurchased: 8 }).seatLimit).toBe(8);
    expect(entitlementsFor({ ...base, seatsPurchased: 2 }).seatLimit).toBe(5);
  });

  it('no deja invitar con el plan lleno', () => {
    const r = assertSeatAvailable({ ...base, activeMembers: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('bajar de plan deja la agencia excedida, no con asientos de regalo', () => {
    const e = entitlementsFor({ ...base, seatsPurchased: 5, activeMembers: 7 });
    expect(e.seatsAvailable).toBe(0);
  });
});
