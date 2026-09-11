'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

const SORTS = [
  ['recent', 'Más recientes'],
  ['price_asc', 'Menor precio'],
  ['price_desc', 'Mayor precio'],
  ['km_asc', 'Menos kilómetros'],
] as const;

export function CatalogFilters({ brands }: { brands: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`/?${next}`, { scroll: false }));
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${pending ? 'opacity-60' : ''}`}
      role="search"
    >
      <input
        type="search"
        defaultValue={params.get('q') ?? ''}
        placeholder="Buscar marca o modelo"
        aria-label="Buscar"
        onChange={(e) => set('q', e.target.value || null)}
        className="h-10 w-full rounded-lg border border-line-strong px-3 text-[14px] focus:border-[var(--brand)] focus:outline-none sm:w-56"
      />

      <select
        value={params.get('brand') ?? ''}
        aria-label="Marca"
        onChange={(e) => set('brand', e.target.value || null)}
        className="h-10 rounded-lg border border-line-strong px-2.5 text-[14px] focus:border-[var(--brand)] focus:outline-none"
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
        aria-label="Ordenar"
        onChange={(e) => set('sort', e.target.value)}
        className="ml-auto h-10 rounded-lg border border-line-strong px-2.5 text-[14px] focus:border-[var(--brand)] focus:outline-none"
      >
        {SORTS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
