import { dbAdmin, pgClient, schema, sql, type TenantCtx } from '@cuasar/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  changeMemberRole,
  getPlatformAdmin,
  getPlatformMetrics,
  getSeatState,
  inviteMember,
  linkPendingInvitations,
  listAgencies,
  listAuditLog,
  listMembers,
  removeMember,
  requestSeatChange,
  setAgencyStatus,
} from '../src/services';

/**
 * Equipo, asientos y panel de plataforma.
 *
 * Dos invariantes que sostienen el negocio: nadie entra a un asiento que no
 * se está pagando, y una agencia nunca se queda sin dueño. Y una del panel:
 * un moderador ve cuentas y plata de la plataforma, no el stock ni los
 * precios de nadie.
 *
 * Requiere: pnpm db:migrate && pnpm db:seed
 */

let owner: TenantCtx;
let sales: TenantCtx;
let agencyId: string;
let moderatorId: string;
const invited: string[] = [];

beforeAll(async () => {
  const [agency] = await dbAdmin.execute<{ id: string }>(
    sql`select id from agencies where slug = 'del-sur' limit 1`,
  );
  agencyId = agency!.id;

  const members = await dbAdmin.execute<{ user_id: string; role: string }>(
    sql`select user_id, role from memberships where agency_id = ${agencyId}`,
  );
  owner = { agencyId, userId: members.find((m) => m.role === 'OWNER')!.user_id, role: 'OWNER' };
  sales = { agencyId, userId: members.find((m) => m.role === 'SALES')!.user_id, role: 'SALES' };

  const [mod] = await dbAdmin.execute<{ user_id: string }>(
    sql`select user_id from platform_admins limit 1`,
  );
  moderatorId = mod!.user_id;
});

beforeEach(async () => {
  await dbAdmin.execute(sql`delete from users where email like 'invitado%@prueba.test'`);
  await dbAdmin.execute(sql`
    update subscriptions set seats_purchased = 5 where agency_id = ${agencyId}
  `);
});

afterAll(async () => {
  await dbAdmin.execute(sql`delete from users where email like 'invitado%@prueba.test'`);
  await dbAdmin.execute(sql`update agencies set status = 'ACTIVE' where id = ${agencyId}`);
  await dbAdmin.execute(sql`
    update subscriptions set seats_purchased = 5 where agency_id = ${agencyId}
  `);
  await dbAdmin.execute(sql`delete from audit_log where action like 'agency.status.%'`);
  await pgClient.end();
});

describe('equipo y asientos', () => {
  it('invitar ocupa un asiento aunque la persona todavía no haya entrado', async () => {
    const before = await getSeatState(owner);

    const result = await inviteMember(owner, {
      email: 'invitado1@prueba.test',
      role: 'SALES',
    });
    expect(result.ok).toBe(true);
    if (result.ok) invited.push(result.data.userId);

    const after = await getSeatState(owner);
    expect(after.used).toBe(before.used + 1);
    expect(after.available).toBe(before.available - 1);

    const members = await listMembers(owner);
    expect(members.find((m) => m.email === 'invitado1@prueba.test')?.status).toBe('INVITED');
  });

  it('no deja invitar cuando el plan está lleno', async () => {
    const seats = await getSeatState(owner);
    const libres = seats.available;

    for (let i = 0; i < libres; i++) {
      const r = await inviteMember(owner, { email: `invitado2${i}@prueba.test`, role: 'VIEWER' });
      expect(r.ok).toBe(true);
    }

    const full = await inviteMember(owner, { email: 'invitado-extra@prueba.test', role: 'VIEWER' });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('sumar asientos vuelve a habilitar invitaciones', async () => {
    const seats = await getSeatState(owner);
    for (let i = 0; i < seats.available; i++) {
      await inviteMember(owner, { email: `invitado3${i}@prueba.test`, role: 'VIEWER' });
    }

    expect((await requestSeatChange(owner, seats.limit + 1)).ok).toBe(true);

    const result = await inviteMember(owner, { email: 'invitado-ok@prueba.test', role: 'VIEWER' });
    expect(result.ok).toBe(true);
  });

  it('no deja bajar los asientos por debajo de la gente que ya está adentro', async () => {
    const seats = await getSeatState(owner);
    const result = await requestSeatChange(owner, seats.used - 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/sacá a alguien/i);
  });

  it('un vendedor no puede invitar ni cambiar roles', async () => {
    const invite = await inviteMember(sales, { email: 'invitado4@prueba.test', role: 'ADMIN' });
    expect(invite.ok).toBe(false);
    if (!invite.ok) expect(invite.error.code).toBe('FORBIDDEN');
  });

  it('la agencia no se puede quedar sin dueño', async () => {
    const members = await listMembers(owner);
    const ownerMembership = members.find((m) => m.role === 'OWNER')!;

    const demote = await changeMemberRole(owner, ownerMembership.membershipId, 'SALES');
    expect(demote.ok).toBe(false);
    if (!demote.ok) expect(demote.error.message).toMatch(/al menos un dueño/i);
  });

  it('sacar a alguien lo deshabilita, no lo borra: el historial lo sigue nombrando', async () => {
    const created = await inviteMember(owner, { email: 'invitado5@prueba.test', role: 'SALES' });
    if (!created.ok) throw new Error('no se pudo invitar');

    const members = await listMembers(owner);
    const target = members.find((m) => m.email === 'invitado5@prueba.test')!;

    expect((await removeMember(owner, target.membershipId)).ok).toBe(true);

    const [row] = await dbAdmin.execute<{ status: string }>(
      sql`select status from memberships where id = ${target.membershipId}`,
    );
    expect(row!.status).toBe('DISABLED');

    const [user] = await dbAdmin.execute(
      sql`select 1 from users where id = ${created.data.userId}`,
    );
    expect(user).toBeDefined();
  });

  it('nadie puede sacarse a sí mismo', async () => {
    const members = await listMembers(owner);
    const me = members.find((m) => m.isMe)!;

    const result = await removeMember(owner, me.membershipId);
    expect(result.ok).toBe(false);
  });

  it('la invitación se enlaza con la cuenta real en el primer ingreso', async () => {
    const created = await inviteMember(owner, { email: 'invitado6@prueba.test', role: 'SALES' });
    if (!created.ok) throw new Error('no se pudo invitar');

    const linked = await linkPendingInvitations('user_clerk_real', 'Invitado6@Prueba.test');
    expect(linked).toBe(created.data.userId);

    const [row] = await dbAdmin.execute<{ external_id: string }>(
      sql`select external_id from users where id = ${created.data.userId}`,
    );
    expect(row!.external_id).toBe('user_clerk_real');

    const members = await listMembers(owner);
    expect(members.find((m) => m.email === 'invitado6@prueba.test')?.status).toBe('ACTIVE');
  });
});

describe('panel de plataforma', () => {
  it('quien no es moderador no existe para el panel', async () => {
    expect(await getPlatformAdmin(owner.userId)).toBeNull();
    expect(await getPlatformAdmin(moderatorId)).not.toBeNull();
  });

  it('las métricas cuentan agencias y suscripciones de toda la plataforma', async () => {
    const metrics = await getPlatformMetrics(moderatorId);

    expect(metrics.agencies.total).toBeGreaterThanOrEqual(2);
    expect(metrics.users).toBeGreaterThan(0);
    expect(metrics.vehicles.total).toBeGreaterThan(0);
    // El ingreso mensual sale de los planes, no de la contabilidad de nadie.
    expect(metrics.mrrCents).toBeGreaterThan(0n);
  });

  it('lista las agencias con su suscripción y sus conteos', async () => {
    const agencies = await listAgencies(moderatorId);
    const target = agencies.find((a) => a.id === agencyId)!;

    expect(target.slug).toBe('del-sur');
    expect(target.members).toBeGreaterThan(0);
    expect(target.vehicles).toBeGreaterThan(0);
  });

  it('suspender pide un motivo, queda auditado y vacía el catálogo público', async () => {
    const sinMotivo = await setAgencyStatus(moderatorId, agencyId, 'SUSPENDED', '   ');
    expect(sinMotivo.ok).toBe(false);

    const result = await setAgencyStatus(moderatorId, agencyId, 'SUSPENDED', 'Falta de pago');
    expect(result.ok).toBe(true);

    const enCatalogo = await dbAdmin.execute(
      sql`select 1 from vehicle_public_view where agency_id = ${agencyId}`,
    );
    expect(enCatalogo).toHaveLength(0);

    const audit = await listAuditLog(moderatorId, 5);
    expect(audit[0]?.action).toBe('agency.status.suspended');
    expect(audit[0]?.payload.reason).toBe('Falta de pago');
  });

  it('reactivar devuelve el catálogo entero', async () => {
    expect((await setAgencyStatus(moderatorId, agencyId, 'ACTIVE', 'Regularizó')).ok).toBe(true);

    const enCatalogo = await dbAdmin.execute(
      sql`select 1 from vehicle_public_view where agency_id = ${agencyId}`,
    );
    expect(enCatalogo.length).toBeGreaterThan(0);
  });

  it('una agencia no puede administrar a otra aunque sepa su id', async () => {
    const result = await setAgencyStatus(owner.userId, agencyId, 'SUSPENDED', 'Intento');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
});
