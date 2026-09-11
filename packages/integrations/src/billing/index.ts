import type { BillingPort, BillingProvider } from '@cuasar/core';
import { MercadoPagoAdapter } from './mercadopago';
import { StripeAdapter } from './stripe';

export * from './stripe';
export * from './mercadopago';

/**
 * El adapter de un proveedor, o null si no está configurado.
 *
 * Devolver null y no tirar es a propósito: una plataforma con Stripe andando
 * y MercadoPago todavía sin credenciales tiene que seguir cobrándole a las
 * agencias que ya pagan.
 */
export function billingAdapter(provider: BillingProvider): BillingPort | null {
  if (provider === 'STRIPE') {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!apiKey || !priceId || !webhookSecret) return null;
    return new StripeAdapter(apiKey, priceId, webhookSecret);
  }

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

  if (!accessToken || !webhookSecret) return null;
  return new MercadoPagoAdapter(
    accessToken,
    webhookSecret,
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.cuasar.app'}/cuenta`,
  );
}

export const availableProviders = (): BillingProvider[] =>
  (['STRIPE', 'MERCADOPAGO'] as const).filter((p) => billingAdapter(p) !== null);
