'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { VEHICLE_STATUSES } from '@cuasar/core';
import { STATUS_META } from './vehicle-meta';
import { cx } from './ui';

const SORTS = [
  { value: 'recent', label: 'Más nuevos' },
  { value: 'stale', label: 'Más tiempo parados' },
  { value: 'price_desc', label: 'Precio ↓' },
  { value: 'price_asc', label: 'Precio ↑' },
] as const;

export function VehicleFilters({ brands }: { brands: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const activeStatus = params.getAll('status');
  const set = (key: string, value: string | string[] | null) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    next.delete('cursor'); // cambiar un filtro reinicia la paginación
    if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
    else if (value) next.set(key, value);
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };

  const toggleStatus = (status: string) => {
    const next = activeStatus.includes(status)
      ? activeStatus.filter((s) => s !== status)
      : [...activeStatus, status];
    set('status', next);
  };

  return (
    <div className={cx('flex flex-col gap-3', pending && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={params.get('q') ?? ''}
          placeholder="Marca, modelo o patente"
          onChange={(e) => set('q', e.target.value || null)}
          className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] placeholder:text-ink-faint focus:border-signal focus:outline-none sm:w-64"
        />

        <select
          value={params.get('ownership') ?? ''}
          onChange={(e) => set('ownership', e.target.value || null)}
          className="h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] focus:border-signal focus:outline-none"
        >
          <option value="">Propios y consignación</option>
          <option value="OWNED">Solo propios</option>
          <option value="CONSIGNMENT">Solo consignación</option>
        </select>

        <select
          value={params.get('brand') ?? ''}
          onChange={(e) => set('brand', e.target.value || null)}
          className="h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] focus:border-signal focus:outline-none"
        >
          <option value="">Todas las marcas</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <select
          value={params.get('sort') ?? 'recent'}
          onChange={(e) => set('sort', e.target.value)}
          className="ml-auto h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] focus:border-signal focus:outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {VEHICLE_STATUSES.map((status) => {
          const on = activeStatus.includes(status);
          return (
            <button
              key={status}
              type="button"
              onClick={() => toggleStatus(status)}
              aria-pressed={on}
              className={cx(
                'rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
                on
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line-strong bg-surface text-ink-soft hover:border-ink/40 hover:text-ink',
              )}
            >
              {STATUS_META[status].label}
            </button>
          );
        })}
        {activeStatus.length > 0 && (
          <button
            type="button"
            onClick={() => set('status', null)}
            className="px-2 py-1 text-[12px] text-ink-faint underline underline-offset-2 hover:text-ink"
          >
            limpiar
          </button>
        )}
      </div>
    </div>
  );
}
