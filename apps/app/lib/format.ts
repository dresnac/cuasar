const MONEY = new Map<string, Intl.NumberFormat>();

export function money(cents: bigint | number | null | undefined, currency = 'USD') {
  if (cents === null || cents === undefined) return '—';
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

export const dateLong = (d: Date) =>
  new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);

export const dateTime = (d: Date) =>
  new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);

/** "hace 3 días", "hoy". La antigüedad es el número que más se mira acá. */
export function relativeDays(days: number) {
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
}
