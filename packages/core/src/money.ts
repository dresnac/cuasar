/**
 * Plata. Enteros en centavos, siempre con moneda.
 *
 * La conversión a la moneda base de la agencia ocurre UNA vez, al registrar
 * la operación, con la cotización de ese momento. Ese `fxRate` se guarda y
 * no se recalcula nunca: un margen de hace dos años tiene que seguir dando
 * lo mismo hoy.
 */
export type Currency = 'USD' | 'ARS';

export type Money = {
  amountCents: bigint;
  currency: Currency;
};

export type BaseMoney = Money & {
  fxRate: string;
  amountBaseCents: bigint;
};

export const money = (amountCents: bigint | number, currency: Currency): Money => ({
  amountCents: BigInt(amountCents),
  currency,
});

/**
 * Convierte a la moneda base de la agencia.
 * `fxRate` = cuántas unidades de `currency` entra una de `baseCurrency`.
 * Redondeo half-up sobre enteros: sin float en ningún punto.
 */
export function toBase(input: Money, baseCurrency: Currency, fxRate: string): BaseMoney {
  if (input.currency === baseCurrency) {
    return { ...input, fxRate: '1', amountBaseCents: input.amountCents };
  }

  const rate = parseRate(fxRate);
  if (rate <= 0n) {
    throw new Error(`fxRate inválido: ${fxRate}`);
  }

  // amount / rate, con 10 decimales de precisión en el divisor.
  const scaled = input.amountCents * SCALE;
  const half = rate / 2n;
  const amountBaseCents = (scaled + half) / rate;

  return { ...input, fxRate, amountBaseCents };
}

const SCALE_DECIMALS = 10;
const SCALE = 10n ** BigInt(SCALE_DECIMALS);

/** "1234.56" -> 1234560000000n  (10 decimales fijos, sin float) */
function parseRate(fxRate: string): bigint {
  const [whole = '0', frac = ''] = fxRate.trim().split('.');
  const padded = (frac + '0'.repeat(SCALE_DECIMALS)).slice(0, SCALE_DECIMALS);
  return BigInt(whole) * SCALE + BigInt(padded || '0');
}

export function formatMoney(amountCents: bigint, currency: Currency, locale = 'es-AR'): string {
  const units = Number(amountCents) / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(units);
}
