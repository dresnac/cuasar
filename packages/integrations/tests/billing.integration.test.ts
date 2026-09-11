import { createHmac } from 'node:crypto';
import { dbAdmin, pgClient, sql } from '@cuasar/db';
import {
  applyBillingEvent,
  claimBillingEvent,
  markBillingEventProcessed,
} from '@cuasar/core/services';
import { entitlementsFor } from '@cuasar/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyMercadoPagoSignature, verifyStripeSignature } from '../src/billing';

/**
 * Cobro.
 *
 * Dos cosas que no pueden fallar nunca: que una firma falsa no entre, y que
 * un reintento del proveedor no vuelva a aplicar algo que ya se aplicó. Un
 * webhook de "pago acreditado" reprocesado fuera de orden puede reactivar una
 * cuenta que se canceló.
 *
 * Requiere: pnpm db:migrate && pnpm db:seed
 */

const SECRET = 'whsec_de_prueba';

function stripeHeader(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

let agencyId: string;
let subscriptionId: string;

beforeAll(async () => {
  const [agency] = await dbAdmin.execute<{ id: string }>(
    sql`select id from agencies where slug = 'del-sur' limit 1`,
  );
  agencyId = agency!.id;

  const [subscription] = await dbAdmin.execute<{ provider_subscription_id: string }>(
    sql`select provider_subscription_id from subscriptions where agency_id = ${agencyId}`,
  );
  subscriptionId = subscription!.provider_subscription_id;
});

beforeEach(async () => {
  await dbAdmin.execute(sql`delete from billing_events where provider_event_id like 'test_%'`);
  await dbAdmin.execute(sql`
    update subscriptions
    set status = 'ACTIVE', grace_period_ends_at = null, seats_purchased = 5
    where agency_id = ${agencyId}
  `);
});

afterAll(async () => {
  await dbAdmin.execute(sql`delete from billing_events where provider_event_id like 'test_%'`);
  await dbAdmin.execute(sql`delete from invoices where provider_invoice_id like 'test_%'`);
  await dbAdmin.execute(sql`
    update subscriptions
    set status = 'ACTIVE', grace_period_ends_at = null, seats_purchased = 5
    where agency_id = ${agencyId}
  `);
  await pgClient.end();
});

describe('firma de Stripe', () => {
  const body = '{"id":"evt_1","type":"invoice.paid"}';

  it('acepta una firma legítima', () => {
    expect(() => verifyStripeSignature(body, stripeHeader(body), SECRET)).not.toThrow();
  });

  it('rechaza un cuerpo modificado después de firmar', () => {
    const header = stripeHeader(body);
    const tampered = body.replace('invoice.paid', 'invoice.refunded');
    expect(() => verifyStripeSignature(tampered, header, SECRET)).toThrow(/inválida/i);
  });

  it('rechaza otra clave', () => {
    expect(() => verifyStripeSignature(body, stripeHeader(body), 'whsec_otra')).toThrow(/inválida/i);
  });

  it('rechaza una firma vieja: un replay no entra', () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(() => verifyStripeSignature(body, stripeHeader(body, SECRET, old), SECRET)).toThrow(
      /vencida/i,
    );
  });

  it('rechaza un header mal formado', () => {
    expect(() => verifyStripeSignature(body, 'cualquier cosa', SECRET)).toThrow(/mal formada/i);
  });
});

describe('firma de MercadoPago', () => {
  const dataId = '123456';
  const requestId = 'req-abc';

  const header = (secret = SECRET, ts = '1700000000') => {
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    return `ts=${ts},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`;
  };

  it('valida sobre el manifiesto, no sobre el cuerpo', () => {
    expect(() =>
      verifyMercadoPagoSignature({ signature: header(), requestId, dataId, secret: SECRET }),
    ).not.toThrow();
  });

  it('rechaza si cambia el id del recurso', () => {
    expect(() =>
      verifyMercadoPagoSignature({ signature: header(), requestId, dataId: '999', secret: SECRET }),
    ).toThrow(/inválida/i);
  });
});

describe('idempotencia de los webhooks', () => {
  it('el primero entra, el reintento antes de procesar se vuelve a aplicar, y después se descarta', async () => {
    const input = {
      provider: 'STRIPE' as const,
      providerEventId: 'test_evt_idem',
      type: 'subscription.activated',
      payload: {},
    };

    expect(await claimBillingEvent(input)).toBe('NEW');

    // Se cayó la aplicación entre registrar y procesar: el reintento del
    // proveedor tiene que volver a intentarlo, no descartarlo.
    expect(await claimBillingEvent(input)).toBe('RETRY');

    await markBillingEventProcessed('STRIPE', 'test_evt_idem');
    expect(await claimBillingEvent(input)).toBe('ALREADY_PROCESSED');
  });

  it('el mismo id en dos proveedores son dos eventos distintos', async () => {
    const base = { providerEventId: 'test_evt_compartido', type: 'x', payload: {} };
    expect(await claimBillingEvent({ ...base, provider: 'STRIPE' })).toBe('NEW');
    expect(await claimBillingEvent({ ...base, provider: 'MERCADOPAGO' })).toBe('NEW');
  });
});

describe('efecto de los eventos sobre la cuenta', () => {
  const ref = () => ({
    provider: 'STRIPE' as const,
    customerId: null,
    subscriptionId,
  });

  it('un pago al día deja la cuenta activa y sin período de gracia', async () => {
    const periodEnd = new Date(Date.now() + 30 * 86_400_000);

    const result = await applyBillingEvent({
      type: 'subscription.activated',
      ref: ref(),
      currentPeriodEnd: periodEnd,
    });
    expect(result.ok).toBe(true);

    const [row] = await dbAdmin.execute<{ status: string; grace_period_ends_at: Date | null }>(
      sql`select status, grace_period_ends_at from subscriptions where agency_id = ${agencyId}`,
    );
    expect(row!.status).toBe('ACTIVE');
    expect(row!.grace_period_ends_at).toBeNull();
  });

  it('un pago rechazado abre el período de gracia, y vencido pasa a solo lectura', async () => {
    await applyBillingEvent({ type: 'subscription.past_due', ref: ref() });

    const [row] = await dbAdmin.execute<{ status: string; grace_period_ends_at: Date }>(
      sql`select status, grace_period_ends_at from subscriptions where agency_id = ${agencyId}`,
    );
    expect(row!.status).toBe('PAST_DUE');

    const grace = new Date(row!.grace_period_ends_at);
    const state = {
      agencyStatus: 'ACTIVE' as const,
      subscriptionStatus: 'PAST_DUE' as const,
      gracePeriodEndsAt: grace,
      includedSeats: 5,
      seatsPurchased: 5,
      activeMembers: 2,
    };

    // Dentro de la gracia sigue escribiendo; después, solo lectura. En los dos
    // casos el sitio público sigue arriba: cortarlo no ayuda a cobrar.
    expect(entitlementsFor(state, new Date()).backoffice).toBe('FULL');
    expect(entitlementsFor(state, new Date(grace.getTime() + 1000)).backoffice).toBe('READ_ONLY');
    expect(entitlementsFor(state, new Date(grace.getTime() + 1000)).publicSiteVisible).toBe(true);
  });

  it('cancelar bloquea la cuenta y despublica el sitio', async () => {
    await applyBillingEvent({ type: 'subscription.cancelled', ref: ref() });

    const [row] = await dbAdmin.execute<{ status: string }>(
      sql`select status from subscriptions where agency_id = ${agencyId}`,
    );
    expect(row!.status).toBe('CANCELLED');

    const entitlements = entitlementsFor({
      agencyStatus: 'ACTIVE',
      subscriptionStatus: 'CANCELLED',
      gracePeriodEndsAt: null,
      includedSeats: 5,
      seatsPurchased: 5,
      activeMembers: 2,
    });
    expect(entitlements.backoffice).toBe('BLOCKED');
    expect(entitlements.publicSiteVisible).toBe(false);
  });

  it('un cambio de asientos se refleja en el límite del equipo', async () => {
    await applyBillingEvent({ type: 'subscription.seats_changed', ref: ref(), seats: 9 });

    const [row] = await dbAdmin.execute<{ seats_purchased: number }>(
      sql`select seats_purchased from subscriptions where agency_id = ${agencyId}`,
    );
    expect(row!.seats_purchased).toBe(9);
  });

  it('una factura se guarda una vez aunque el evento llegue dos veces', async () => {
    const invoice = {
      id: 'test_in_001',
      amountCents: 10_000n,
      currency: 'USD',
      status: 'PAID' as const,
      issuedAt: new Date(),
      paidAt: new Date(),
      pdfUrl: null,
    };

    await applyBillingEvent({ type: 'invoice.paid', ref: ref(), invoice });
    await applyBillingEvent({ type: 'invoice.paid', ref: ref(), invoice });

    const rows = await dbAdmin.execute(
      sql`select 1 from invoices where provider_invoice_id = 'test_in_001'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('un evento de una suscripción que no conocemos no rompe nada', async () => {
    const result = await applyBillingEvent({
      type: 'subscription.cancelled',
      ref: { provider: 'STRIPE', customerId: null, subscriptionId: 'sub_inexistente' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});
