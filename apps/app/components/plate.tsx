/**
 * La patente, como chapa. Es el identificador con el que la gente del patio
 * habla de una unidad; en pantalla tiene que verse como se ve en el auto.
 */
export function Plate({ value, size = 'md' }: { value: string | null; size?: 'sm' | 'md' }) {
  if (!value) {
    return (
      <span className="inline-flex items-center rounded border border-dashed border-line-strong px-2 py-1 text-[11px] text-ink-faint">
        sin patente
      </span>
    );
  }

  return (
    <span className="plate" aria-label={`Patente ${value}`}>
      <span className="plate-band" aria-hidden />
      <span className={`plate-text ${size === 'sm' ? 'text-[11px]' : 'text-[13px]'}`}>{value}</span>
    </span>
  );
}
