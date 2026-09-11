'use client';

import { useId, useState } from 'react';
import type { MonthlyPoint } from '@cuasar/core/services';
import { money } from '@/lib/format';

/**
 * Margen realizado por mes.
 *
 * Un mes con pérdida se dibuja bajo la línea de cero: la posición ya dice el
 * signo, así que el color no es la única pista. Azul y rojo, no verde y rojo,
 * porque ese par se distingue también con daltonismo.
 */
export function MonthlyMarginChart({
  data,
  baseCurrency,
}: {
  data: MonthlyPoint[];
  baseCurrency: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();

  const values = data.map((d) => Number(d.marginBaseCents));
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;

  const H = 132;
  const zeroY = (max / span) * H;

  if (values.every((v) => v === 0)) {
    return (
      <p className="py-10 text-center text-[13px] text-ink-soft">
        Todavía no hay ventas cerradas en los últimos doce meses.
      </p>
    );
  }

  return (
    <figure className="relative">
      <div className="flex items-end gap-1" style={{ height: H }} aria-hidden>
        {data.map((point, i) => {
          const value = values[i]!;
          const positive = value >= 0;
          const height = Math.max(value === 0 ? 0 : 3, (Math.abs(value) / span) * H);
          const active = hover === i;

          return (
            <div
              key={point.month}
              className="relative flex-1"
              style={{ height: H }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className="absolute w-full rounded-[3px] transition-opacity"
                style={{
                  height,
                  bottom: positive ? H - zeroY : H - zeroY - height,
                  background: positive ? 'var(--color-signal)' : 'var(--color-stale)',
                  opacity: hover === null || active ? 1 : 0.4,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Línea de cero: la referencia contra la que se lee cada barra. */}
      <div
        className="pointer-events-none absolute inset-x-0 border-t border-line-strong"
        style={{ top: zeroY }}
        aria-hidden
      />

      <div className="mt-2 flex gap-1" aria-hidden>
        {data.map((point, i) => (
          <span
            key={point.month}
            className={`tabular flex-1 text-center text-[10px] ${
              hover === i ? 'text-ink' : 'text-ink-faint'
            }`}
          >
            {i % 2 === 0 || hover === i ? monthLabel(point.month) : ''}
          </span>
        ))}
      </div>

      {hover !== null && data[hover] && (
        <div
          role="tooltip"
          className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-lg shadow-ink/5"
        >
          <span className="font-medium">{monthLabel(data[hover]!.month, true)}</span>
          <span className="tabular ml-2">
            {money(data[hover]!.marginBaseCents, baseCurrency)}
          </span>
          <span className="ml-2 text-ink-faint">
            {data[hover]!.unitsSold} {data[hover]!.unitsSold === 1 ? 'unidad' : 'unidades'}
          </span>
        </div>
      )}

      <figcaption id={titleId} className="sr-only">
        Margen realizado por mes en {baseCurrency}, últimos doce meses.
      </figcaption>

      <table className="sr-only">
        <caption>Margen por mes</caption>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            <th scope="col">Unidades</th>
            <th scope="col">Margen</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <th scope="row">{monthLabel(d.month, true)}</th>
              <td>{d.unitsSold}</td>
              <td>{money(d.marginBaseCents, baseCurrency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function monthLabel(key: string, long = false) {
  const [year, month] = key.split('-');
  const name = MONTHS[Number(month) - 1] ?? key;
  return long ? `${name} ${year}` : name;
}
