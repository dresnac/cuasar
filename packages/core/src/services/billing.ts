import { and, dbAdmin, desc, eq, schema, sql, type TenantCtx } from '@cuasar/db';
import { fail, ok, type Result } from '../errors';
import { can } from '../permissions';
import type { BillingEvent, BillingProvider, ProviderSubscription } from '../ports/billing';

const { agencies, invoices, billingEvents, memberships, plans, subscriptions } = schema;

/**
 * Suscripciones.
 *
 * `subscriptions` es una proyección del estado en el proveedor, nunca la
 * fuente de verdad: los webhooks la actualizan y un cron la reconcilia. Por
 * eso ninguna agencia puede escribirla —el rol `app_tenant` tiene revocado el
 * insert y el update— y todo lo de acá corre con el rol dueño, fuera de RLS.
 *
 * El resto del sistema no sabe qué proveedor cobró: los dos webhooks se
 * normalizan a los mismos eventos de dominio antes de llegar acá.
 */

export type BillingSummary = {
  planCode: string;
  planName: string;
  priceCents: bigint;
  currency: string;
  includedSeats: number;
  extraSeatPriceCents: bigint;
  status: string;
  provider: BillingProvider;
  seatsPurchased: number;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  gracePeriodEndsAt: Date | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  invoices: {
    id: string;
    amountCents: bigint;
    currency: string;
    status: string;
    issuedAt: Date;
    pdfUrl: string | null;
  }[];
};

export async function getBillingSummary(ctx: TenantCtx): Promise<Result<BillingSummary>> {
  if (!can(ctx.role, 'billing:manage')) {
    return fail('FORBIDDEN', 'Solo un administrador ve la facturación.');
  }

  const [row] = await dbAdmin
    .select({
      planCode: plans.code,
      planName: plans.name,
      priceCents: plans.priceCents,
      currency: plans.currency,
      includedSeats: plans.includedSeats,
      extraSeatPriceCents: plans.extraSeatPriceCents,
      status: subscriptions.status,
      provider: subscriptions.provider,
      seatsPurchased: subscriptions.seatsPurchased,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      gracePeriodEndsAt: subscriptions.gracePeriodEndsAt,
      providerCustomerId: subscriptions.providerCustomerId,
      providerSubscriptionId: subscriptions.providerSubscriptionId,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.code, subscriptions.planCode))
    .where(and(eq(subscriptions.agencyId, ctx.agencyId), sql`${subscriptions.status} <> 'CANCELLED'`))
    .limit(1);

  if (!row) return fail('NOT_FOUND', 'Esta agencia no tiene una suscripción activa.');

  const history = await dbAdmin
    .select({
      id: invoices.id,
      amountCents: invoices.amountCents,
      currency: invoices.currency,
      status: invoices.status,
      issuedAt: invoices.issuedAt,
      pdfUrl: invoices.pdfUrl,
    })
    .from(invoices)
    .where(eq(invoices.agencyId, ctx.agencyId))
    .orderBy(desc(invoices.issuedAt))
    .limit(12);

  return ok({
    ...row,
    provider: row.provider as BillingProvider,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
    invoices: history,
  });
}

/**
 * Reserva el evento del proveedor antes de aplicarlo.
 *
 * Stripe y MercadoPago reintentan y llegan desordenados. La clave única
 * `(provider, provider_event_id)` es lo que evita que un reintento de "pago
 * acreditado" reactive una suscripción que después se canceló.
 *
 * Distingue tres casos a propósito. Uno nuevo se aplica. Uno que ya se
 * procesó se descarta. Uno que se registró pero **no** se llegó a procesar
 * —porque la aplicación se cayó a mitad de camino— se vuelve a aplicar: si
 * el duplicado se descartara sin mirar eso, una falla transitoria dejaría la
 * suscripción desincronizada para siempre.
 */
export type EventClaim = 'NEW' | 'RETRY' | 'ALREADY_PROCESSED';

export async function claimBillingEvent(input: {
  provider: BillingProvider;
  providerEventId: string;
  type: string;
  payload: unknown;
  agencyId?: string | null;
}): Promise<EventClaim> {
  const inserted = await dbAdmin
    .insert(billingEvents)
    .values({
      provider: input.provider,
      providerEventId: input.providerEventId,
      type: input.type,
      payload: input.payload as Record<string, unknown>,
      agencyId: input.agencyId ?? null,
    })
    .onConflictDoNothing({ target: [billingEvents.provider, billingEvents.providerEventId] })
    .returning({ id: billingEvents.id });

  if (inserted.length > 0) return 'NEW';

  const [existing] = await dbAdmin
    .select({ processedAt: billingEvents.processedAt })
    .from(billingEvents)
    .where(
      and(
        eq(billingEvents.provider, input.provider),
        eq(billingEvents.providerEventId, input.providerEventId),
      ),
    )
    .limit(1);

  return existing?.processedAt ? 'ALREADY_PROCESSED' : 'RETRY';
}

export async function markBillingEventProcessed(
  provider: BillingProvider,
  providerEventId: string,
  error?: string,
) {
  await dbAdmin
    .update(billingEvents)
    .set({ processedAt: new Date(), error: error?.slice(0, 500) ?? null })
    .where(
      and(
        eq(billingEvents.provider, provider),
        eq(billingEvents.providerEventId, providerEventId),
      ),
    );
}

/** Cuánto puede pasar sin pagar antes de que la cuenta pase a solo lectura. */
const GRACE_DAYS = 7;

/**
 * Aplica un evento ya normalizado sobre la proyección local.
 *
 * Es deliberadamente aburrido: busca la suscripción por la referencia del
 * proveedor y actualiza campos. Toda la inteligencia de qué significa cada
 * estado vive en `entitlements`, un solo lugar.
 */
export async function applyBillingEvent(event: BillingEvent): Promise<Result<true>> {
  if (event.type === 'ignored') return ok(true as const);

  const agencyId = await agencyForRef(event.ref);
  if (!agencyId) {
    return fail('NOT_FOUND', 'El evento no corresponde a ninguna suscripción conocida.');
  }

  switch (event.type) {
    case 'subscription.activated':
      await dbAdmin
        .update(subscriptions)
        .set({
          status: 'ACTIVE',
          currentPeriodEnd: event.currentPeriodEnd,
          gracePeriodEndsAt: null,
        })
        .where(eq(subscriptions.agencyId, agencyId));
      await dbAdmin.update(agencies).set({ status: 'ACTIVE' }).where(eq(agencies.id, agencyId));
      break;

    case 'subscription.past_due':
      await dbAdmin
        .update(subscriptions)
        .set({
          status: 'PAST_DUE',
          gracePeriodEndsAt: new Date(Date.now() + GRACE_DAYS * 86_400_000),
        })
        .where(eq(subscriptions.agencyId, agencyId));
      break;

    case 'subscription.cancelled':
      await dbAdmin
        .update(subscriptions)
        .set({ status: 'CANCELLED', gracePeriodEndsAt: null })
        .where(eq(subscriptions.agencyId, agencyId));
      break;

    case 'subscription.seats_changed':
      await dbAdmin
        .update(subscriptions)
        .set({ seatsPurchased: event.seats })
        .where(eq(subscriptions.agencyId, agencyId));
      break;

    case 'invoice.paid':
    case 'invoice.failed': {
      const invoice = event.invoice;
      await dbAdmin
        .insert(invoices)
        .values({
          agencyId,
          provider: event.ref.provider,
          providerInvoiceId: invoice.id,
          amountCents: invoice.amountCents,
          currency: invoice.currency,
          status: invoice.status,
          issuedAt: invoice.issuedAt,
          paidAt: invoice.paidAt,
          pdfUrl: invoice.pdfUrl,
        })
        .onConflictDoUpdate({
          target: [invoices.provider, invoices.providerInvoiceId],
          set: { status: invoice.status, paidAt: invoice.paidAt, pdfUrl: invoice.pdfUrl },
        });
      break;
    }
  }

  return ok(true as const);
}

async function agencyForRef(ref: {
  provider: BillingProvider;
  customerId: string | null;
  subscriptionId: string | null;
}): Promise<string | null> {
  const [row] = await dbAdmin
    .select({ agencyId: subscriptions.agencyId })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.provider, ref.provider),
        ref.subscriptionId
          ? eq(subscriptions.providerSubscriptionId, ref.subscriptionId)
          : ref.customerId
            ? eq(subscriptions.providerCustomerId, ref.customerId)
            : sql`false`,
      ),
    )
    .limit(1);

  return row?.agencyId ?? null;
}

/** Deja registrada la suscripción recién creada en el proveedor. */
export async function attachSubscription(
  agencyId: string,
  provider: ProviderSubscription,
): Promise<void> {
  await dbAdmin
    .update(subscriptions)
    .set({
      provider: provider.provider,
      providerCustomerId: provider.customerId,
      providerSubscriptionId: provider.subscriptionId,
      status: provider.status,
      currentPeriodEnd: provider.currentPeriodEnd,
    })
    .where(eq(subscriptions.agencyId, agencyId));
}

/**
 * Cambia la cantidad de asientos facturados.
 *
 * No deja bajar por debajo de la gente que ya está adentro: primero se saca
 * a alguien del equipo, después se paga por menos asientos. Al revés, la
 * agencia quedaría con cuentas que no puede usar y sin saber cuál se apaga.
 */
export async function requestSeatChange(
  ctx: TenantCtx,
  seats: number,
): Promise<Result<{ seats: number }>> {
  if (!can(ctx.role, 'billing:manage')) {
    return fail('FORBIDDEN', 'Solo un administrador cambia el plan.');
  }

  const [row] = await dbAdmin
    .select({ included: plans.includedSeats, subscriptionId: subscriptions.id })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.code, subscriptions.planCode))
    .where(eq(subscriptions.agencyId, ctx.agencyId))
    .limit(1);

  if (!row) return fail('NOT_FOUND', 'Esta agencia no tiene suscripción.');

  const [used] = await dbAdmin
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(
      and(eq(memberships.agencyId, ctx.agencyId), sql`${memberships.status} <> 'DISABLED'`),
    );

  const active = Number(used?.n ?? 0);
  if (seats < active) {
    return fail(
      'VALIDATION',
      `Hay ${active} personas en el equipo. Sacá a alguien antes de bajar a ${seats} asientos.`,
    );
  }
  if (seats < row.included) {
    return fail('VALIDATION', `El plan incluye ${row.included} asientos como mínimo.`);
  }

  await dbAdmin
    .update(subscriptions)
    .set({ seatsPurchased: seats })
    .where(eq(subscriptions.id, row.subscriptionId));

  return ok({ seats });
}
