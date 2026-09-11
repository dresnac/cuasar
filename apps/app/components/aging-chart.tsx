import type { AgeBucket } from '@cuasar/core/services';
import { money } from '@/lib/format';

const TONES = ['var(--color-fresh)', 'var(--color-fresh)', 'var(--color-warm)', 'var(--color-stale)'];

/**
 * Cuánto stock hay en cada tramo de antigüedad, y cuánto capital propio
 * está parado ahí. Es la versión agregada de la barra que aparece en cada
 * ficha, y responde la pregunta que la lista contesta de a una unidad.
 */
export function AgingChart({
  buckets,
  baseCurrency,
}: {
  buckets: AgeBucket[];
  baseCurrency: string;
}) {
  const maxUnits = Math.max(1, ...buckets.map((b) => b.units));

  return (
    <ul className="flex flex-col gap-3">
      {buckets.map((bucket, i) => (
        <li key={bucket.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-[13px]">{bucket.label}</span>
            <span className="tabular text-[12px] text-ink-soft">
              {bucket.units} {bucket.units === 1 ? 'unidad' : 'unidades'}
              {bucket.capitalBaseCents > 0n && (
                <span className="ml-2 text-ink-faint">
                  {money(bucket.capitalBaseCents, baseCurrency)} propios
                </span>
              )}
            </span>
          </div>
          <div className="h-2 rounded-full bg-paper">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(bucket.units ? 3 : 0, (bucket.units / maxUnits) * 100)}%`,
                background: TONES[i],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
