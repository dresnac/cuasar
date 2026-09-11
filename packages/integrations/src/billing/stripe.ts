import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  BillingEvent,
  BillingPort,
  ProviderInvoice,
  ProviderSubscription,
} from '@cuasar/core';

/**
 * Stripe, por su API REST.
 *
 * Sin SDK, igual que el adapter de mail: son cuatro endpoints con
 * `application/x-www-form-urlencoded` y una verificación de firma. Una
 * dependencia menos que seguir actualizando, y el contrato queda a la vista.
 */
export class StripeAdapter implements BillingPort {
  readonly provider = 'STRIPE' as const;

  constructor(
    private readonly apiKey: string,
    private readonly priceId: string,
    private readonly webhookSecret: string,
  ) {}

  async createSubscription(input: {
    agencyId: string;
    agencyName: string;
    email: string;
    planCode: string;
    seats: number;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<ProviderSubscription> {
    const customer = await this.post<{ id: string }>('/v1/customers', {
      email: input.email,
      name: input.agencyName,
      'metadata[agencyId]': input.agencyId,
    });

    // Checkout y no una suscripción directa: los datos de la tarjeta nunca
    // pasan por nuestro servidor, que es la única forma sensata de hacerlo.
    const session = await this.post<{ id: string; url: string }>('/v1/checkout/sessions', {
      mode: 'subscription',
      customer: customer.id,
      'line_items[0][price]': this.priceId,
      'line_items[0][quantity]': String(input.seats),
      'subscription_data[metadata][agencyId]': input.agencyId,
      success_url: input.successUrl ?? 'https://app.cuasar.app/cuenta?pago=ok',
      cancel_url: input.cancelUrl ?? 'https://app.cuasar.app/cuenta',
    });

    return {
      provider: 'STRIPE',
      customerId: customer.id,
      subscriptionId: '',
      status: 'TRIALING',
      currentPeriodEnd: null,
      checkoutUrl: session.url,
    };
  }

  async updateSeats(subscriptionId: string, seats: number): Promise<void> {
    const subscription = await this.get<{ items: { data: { id: string }[] } }>(
      `/v1/subscriptions/${subscriptionId}`,
    );
    const item = subscription.items.data[0];
    if (!item) throw new Error('La suscripción no tiene ítems');

    await this.post(`/v1/subscription_items/${item.id}`, {
      quantity: String(seats),
      proration_behavior: 'create_prorations',
    });
  }

  async cancel(subscriptionId: string, atPeriodEnd: boolean): Promise<void> {
    if (atPeriodEnd) {
      await this.post(`/v1/subscriptions/${subscriptionId}`, { cancel_at_period_end: 'true' });
      return;
    }
    await this.request('DELETE', `/v1/subscriptions/${subscriptionId}`);
  }

  async portalUrl(customerId: string, returnUrl: string): Promise<string> {
    const session = await this.post<{ url: string }>('/v1/billing_portal/sessions', {
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  /**
   * Verifica la firma y normaliza.
   *
   * La firma se calcula sobre `<timestamp>.<cuerpo crudo>`, así que el cuerpo
   * tiene que ser exactamente el que llegó: cualquier `JSON.parse` y vuelta a
   * serializar rompe la verificación.
   */
  async parseWebhook(request: Request): Promise<{ providerEventId: string; event: BillingEvent }> {
    const raw = await request.text();
    const header = request.headers.get('stripe-signature') ?? '';

    verifyStripeSignature(raw, header, this.webhookSecret);

    const payload = JSON.parse(raw) as {
      id: string;
      type: string;
      data: { object: Record<string, unknown> };
    };

    return { providerEventId: payload.id, event: normalize(payload) };
  }

  // --- HTTP ---------------------------------------------------------------

  private get<T>(path: string) {
    return this.request<T>('GET', path);
  }

  private post<T = unknown>(path: string, body: Record<string, string>) {
    return this.request<T>('POST', path, new URLSearchParams(body));
  }

  private async request<T>(method: string, path: string, body?: URLSearchParams): Promise<T> {
    const response = await fetch(`https://api.stripe.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Stripe respondió ${response.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text) as T;
  }
}

/** Tolerancia de reloj para la firma. Más que esto es un replay. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyStripeSignature(raw: string, header: string, secret: string): void {
  const parts = Object.fromEntries(
    header.split(',').map((part) => part.split('=', 2) as [string, string]),
  );

  const timestamp = Number(parts.t);
  const signature = parts.v1;

  if (!timestamp || !signature) throw new Error('Firma de Stripe mal formada');

  if (Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new Error('Firma de Stripe vencida');
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');

  // Comparación en tiempo constante: una comparación normal filtra, byte a
  // byte, cuánto de la firma acertó quien la está adivinando.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Firma de Stripe inválida');
  }
}

function normalize(payload: {
  type: string;
  data: { object: Record<string, unknown> };
}): BillingEvent {
  const object = payload.data.object;

  switch (payload.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const ref = refOf(object);
      const status = String(object.status);

      if (status === 'active' || status === 'trialing') {
        return {
          type: 'subscription.activated',
          ref,
          currentPeriodEnd: secondsToDate(object.current_period_end),
        };
      }
      if (status === 'past_due' || status === 'unpaid') {
        return { type: 'subscription.past_due', ref };
      }
      if (status === 'canceled') return { type: 'subscription.cancelled', ref };

      return { type: 'ignored', reason: `estado de suscripción ${status}` };
    }

    case 'customer.subscription.deleted':
      return { type: 'subscription.cancelled', ref: refOf(object) };

    case 'invoice.paid':
      return { type: 'invoice.paid', ref: invoiceRef(object), invoice: invoiceOf(object, 'PAID') };

    case 'invoice.payment_failed':
      return {
        type: 'invoice.failed',
        ref: invoiceRef(object),
        invoice: invoiceOf(object, 'OPEN'),
      };

    default:
      return { type: 'ignored', reason: payload.type };
  }
}

const refOf = (object: Record<string, unknown>) => ({
  provider: 'STRIPE' as const,
  customerId: typeof object.customer === 'string' ? object.customer : null,
  subscriptionId: typeof object.id === 'string' ? object.id : null,
});

const invoiceRef = (object: Record<string, unknown>) => ({
  provider: 'STRIPE' as const,
  customerId: typeof object.customer === 'string' ? object.customer : null,
  subscriptionId: typeof object.subscription === 'string' ? object.subscription : null,
});

function invoiceOf(object: Record<string, unknown>, status: 'PAID' | 'OPEN'): ProviderInvoice {
  return {
    id: String(object.id),
    amountCents: BigInt(Number(object.amount_due ?? object.total ?? 0)),
    currency: String(object.currency ?? 'usd').toUpperCase(),
    status,
    issuedAt: secondsToDate(object.created) ?? new Date(),
    paidAt: status === 'PAID' ? (secondsToDate(object.status_transitions_paid_at) ?? new Date()) : null,
    pdfUrl: typeof object.invoice_pdf === 'string' ? object.invoice_pdf : null,
  };
}

const secondsToDate = (value: unknown): Date | null =>
  typeof value === 'number' ? new Date(value * 1000) : null;
