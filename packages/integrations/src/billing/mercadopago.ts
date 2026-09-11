import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingEvent, BillingPort, ProviderSubscription } from '@cuasar/core';

/**
 * MercadoPago, con preapproval (débito recurrente).
 *
 * Existe porque buena parte de las agencias argentinas no tiene tarjeta
 * habilitada para un cargo en dólares del exterior, y sin esto Stripe las
 * deja afuera.
 *
 * Lo que MercadoPago no trae —y Stripe sí— es portal de facturación y
 * reintentos automáticos: `portalUrl` devuelve una pantalla propia, y el
 * estado se reconcilia contra su API además de por webhook.
 */
export class MercadoPagoAdapter implements BillingPort {
  readonly provider = 'MERCADOPAGO' as const;

  constructor(
    private readonly accessToken: string,
    private readonly webhookSecret: string,
    private readonly backUrl: string,
  ) {}

  async createSubscription(input: {
    agencyId: string;
    agencyName: string;
    email: string;
    planCode: string;
    seats: number;
    amountArs?: number;
  }): Promise<ProviderSubscription> {
    const preapproval = await this.post<{ id: string; init_point: string; status: string }>(
      '/preapproval',
      {
        reason: `Cuasar — ${input.agencyName}`,
        external_reference: input.agencyId,
        payer_email: input.email,
        back_url: this.backUrl,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: input.amountArs ?? 0,
          currency_id: 'ARS',
        },
      },
    );

    return {
      provider: 'MERCADOPAGO',
      customerId: input.email,
      subscriptionId: preapproval.id,
      status: 'TRIALING',
      currentPeriodEnd: null,
      checkoutUrl: preapproval.init_point,
    };
  }

  async updateSeats(subscriptionId: string, seats: number): Promise<void> {
    // El monto lo define la plataforma; acá solo se ajusta lo que se cobra.
    await this.put(`/preapproval/${subscriptionId}`, {
      auto_recurring: { transaction_amount: seats },
    });
  }

  async cancel(subscriptionId: string): Promise<void> {
    await this.put(`/preapproval/${subscriptionId}`, { status: 'cancelled' });
  }

  /** MercadoPago no tiene portal propio: es una pantalla nuestra. */
  async portalUrl(_customerId: string, returnUrl: string): Promise<string> {
    return `${returnUrl}?proveedor=mercadopago`;
  }

  async parseWebhook(request: Request): Promise<{ providerEventId: string; event: BillingEvent }> {
    const raw = await request.text();
    const url = new URL(request.url);
    const dataId = url.searchParams.get('data.id') ?? '';

    verifyMercadoPagoSignature({
      signature: request.headers.get('x-signature') ?? '',
      requestId: request.headers.get('x-request-id') ?? '',
      dataId,
      secret: this.webhookSecret,
    });

    const body = JSON.parse(raw || '{}') as { id?: string; type?: string; data?: { id?: string } };
    const preapprovalId = body.data?.id ?? dataId;

    // El webhook solo avisa que algo cambió: el estado real se pregunta.
    const preapproval = await this.get<{ id: string; status: string; next_payment_date?: string }>(
      `/preapproval/${preapprovalId}`,
    );

    const ref = {
      provider: 'MERCADOPAGO' as const,
      customerId: null,
      subscriptionId: preapproval.id,
    };

    const eventId = `${body.id ?? preapprovalId}:${preapproval.status}`;

    switch (preapproval.status) {
      case 'authorized':
        return {
          providerEventId: eventId,
          event: {
            type: 'subscription.activated',
            ref,
            currentPeriodEnd: preapproval.next_payment_date
              ? new Date(preapproval.next_payment_date)
              : null,
          },
        };
      case 'paused':
        return { providerEventId: eventId, event: { type: 'subscription.past_due', ref } };
      case 'cancelled':
        return { providerEventId: eventId, event: { type: 'subscription.cancelled', ref } };
      default:
        return {
          providerEventId: eventId,
          event: { type: 'ignored', reason: `estado ${preapproval.status}` },
        };
    }
  }

  // --- HTTP ---------------------------------------------------------------

  private get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  private post<T>(path: string, body: unknown) {
    return this.request<T>('POST', path, body);
  }
  private put<T = unknown>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://api.mercadopago.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`MercadoPago respondió ${response.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text || '{}') as T;
  }
}

/**
 * La firma de MercadoPago se calcula sobre un manifiesto armado, no sobre el
 * cuerpo: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
 */
export function verifyMercadoPagoSignature(input: {
  signature: string;
  requestId: string;
  dataId: string;
  secret: string;
}): void {
  const parts = Object.fromEntries(
    input.signature.split(',').map((part) => part.split('=', 2).map((s) => s.trim()) as [string, string]),
  );

  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) throw new Error('Firma de MercadoPago mal formada');

  const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${ts};`;
  const expected = createHmac('sha256', input.secret).update(manifest).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Firma de MercadoPago inválida');
  }
}
