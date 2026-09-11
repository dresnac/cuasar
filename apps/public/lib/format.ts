const MONEY = new Map<string, Intl.NumberFormat>();

export function price(cents: bigint, currency: string) {
  let fmt = MONEY.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    MONEY.set(currency, fmt);
  }
  return fmt.format(Number(cents) / 100);
}

const KM = new Intl.NumberFormat('es-AR');
export const km = (n: number) => `${KM.format(n)} km`;

export const FUEL_LABEL: Record<string, string> = {
  NAFTA: 'Nafta',
  DIESEL: 'Diésel',
  GNC: 'GNC',
  HIBRIDO: 'Híbrido',
  ELECTRICO: 'Eléctrico',
};

export const TRANSMISSION_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  AUTOMATICA: 'Automática',
};
