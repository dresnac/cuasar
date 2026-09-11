import type { ReactNode } from 'react';
import { cx } from './ui';

/**
 * Un número con su nombre. No es un gráfico y no debería intentar serlo:
 * cuando el dato es un solo valor, la forma correcta es el valor.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'fresh' | 'stale' | 'warm';
  children?: ReactNode;
}) {
  const toneClass = {
    neutral: 'text-ink',
    fresh: 'text-fresh',
    stale: 'text-stale',
    warm: 'text-warm',
  }[tone];

  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <p className={cx('tabular mt-1.5 font-display text-[26px] font-semibold leading-none tracking-tight', toneClass)}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[12px] leading-snug text-ink-soft">{hint}</p>}
      {children}
    </div>
  );
}
