/**
 * Cobro. Stripe y MercadoPago detrás de la misma interfaz.
 *
 * La agencia elige proveedor al darse de alta: Stripe resuelve tarjeta
 * internacional con portal y dunning incluidos; MercadoPago es
 * imprescindible para la agencia que no tiene tarjeta habilitada en USD.
 *
 * El resto del sistema —entitlements, panel de plataforma, modo lectura—
 * no sabe cuál de los dos cobró.
 */
export type BillingProvider = 'STRIPE' | 'MERCADOPAGO';

export type ProviderSubscription = {
  provider: BillingProvider;
  customerId: string;
  subscriptionId: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  currentPeriodEnd: Date | null;
  /** URL a la que mandar al usuario para completar el pago, si hace falta. */
  checkoutUrl?: string;
};

/** Eventos normalizados: los dos proveedores terminan acá. */
export type BillingEvent =
  | { type: 'subscription.activated'; ref: SubscriptionRef; currentPeriodEnd: Date | null }
  | { type: 'subscription.past_due'; ref: SubscriptionRef }
  | { type: 'subscription.cancelled'; ref: SubscriptionRef }
  | { type: 'subscription.seats_changed'; ref: SubscriptionRef; seats: number }
  | { type: 'invoice.paid'; ref: SubscriptionRef; invoice: ProviderInvoice }
  | { type: 'invoice.failed'; ref: SubscriptionRef; invoice: ProviderInvoice }
  | { type: 'ignored'; reason: string };

export type SubscriptionRef = {
  provider: BillingProvider;
  customerId: string | null;
  subscriptionId: string | null;
};

export type ProviderInvoice = {
  id: string;
  amountCents: bigint;
  currency: string;
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';
  issuedAt: Date;
  paidAt: Date | null;
  pdfUrl: string | null;
};

export interface BillingPort {
  readonly provider: BillingProvider;

  createSubscription(input: {
    agencyId: string;
    agencyName: string;
    email: string;
    planCode: string;
    seats: number;
  }): Promise<ProviderSubscription>;

  updateSeats(subscriptionId: string, seats: number): Promise<void>;
  cancel(subscriptionId: string, atPeriodEnd: boolean): Promise<void>;

  /** Stripe devuelve su portal; MercadoPago, una pantalla propia nuestra. */
  portalUrl(customerId: string, returnUrl: string): Promise<string>;

  /**
   * Verifica la firma y normaliza. Devolver el `providerEventId` es
   * obligatorio: es la clave de idempotencia contra reintentos.
   */
  parseWebhook(req: Request): Promise<{ providerEventId: string; event: BillingEvent }>;
}
