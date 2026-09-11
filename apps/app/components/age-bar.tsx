import { AGE_CEILING, ageTone } from './vehicle-meta';

/**
 * Antigüedad en stock. El elemento firma de la interfaz.
 *
 * Un auto parado es capital inmovilizado, y en un patio nadie lleva la
 * cuenta de cabeza. La barra hace que "hace cuánto que está" sea lo primero
 * que se ve en una lista, sin tener que leer una fecha.
 */
export function AgeBar({
  days,
  sold = false,
  label = true,
}: {
  days: number;
  sold?: boolean;
  label?: boolean;
}) {
  const tone = ageTone(days);
  const pct = Math.min(100, (days / AGE_CEILING) * 100);

  return (
    <div className="flex items-center gap-2">
      <div className="age-track w-full min-w-10 max-w-24" role="presentation">
        <div
          className="age-fill"
          style={{
            width: `${Math.max(4, pct)}%`,
            background: sold ? 'var(--color-line-strong)' : tone.fill,
          }}
        />
      </div>
      {label && (
        <span
          className={`tabular shrink-0 text-[12px] tracking-tight ${sold ? 'text-ink-faint' : tone.text}`}
          title={sold ? 'Días que tardó en venderse' : 'Días en el patio'}
        >
          {days}d
        </span>
      )}
    </div>
  );
}
