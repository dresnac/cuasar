import type { VehicleStatus } from '@cuasar/core';

/**
 * Los estados y su lectura visual, en un solo lugar. Si un estado significa
 * algo distinto en la lista que en la ficha, la interfaz miente.
 */
export const STATUS_META: Record<
  VehicleStatus,
  { label: string; dot: string; chip: string; hint: string }
> = {
  INGRESADO: {
    label: 'Ingresado',
    dot: 'bg-ink-faint',
    chip: 'bg-paper text-ink-soft border-line-strong',
    hint: 'Entró al patio, todavía sin preparar',
  },
  EN_PREPARACION: {
    label: 'En preparación',
    dot: 'bg-warm',
    chip: 'bg-warm-soft text-warm border-warm/30',
    hint: 'En taller, limpieza o papeles',
  },
  PUBLICADO: {
    label: 'Publicado',
    dot: 'bg-signal',
    chip: 'bg-signal-soft text-signal border-signal/25',
    hint: 'Visible en el sitio público',
  },
  RESERVADO: {
    label: 'Reservado',
    dot: 'bg-[#6d3fd4]',
    chip: 'bg-[#f1ecfd] text-[#5a2fbd] border-[#6d3fd4]/25',
    hint: 'Con seña, fuera de circulación',
  },
  VENDIDO: {
    label: 'Vendido',
    dot: 'bg-fresh',
    chip: 'bg-fresh-soft text-fresh border-fresh/25',
    hint: 'Operación cerrada',
  },
  PAUSADO: {
    label: 'Pausado',
    dot: 'bg-ink-faint',
    chip: 'bg-paper text-ink-soft border-line-strong',
    hint: 'Fuera del catálogo, sigue en el patio',
  },
  DEVUELTO: {
    label: 'Devuelto',
    dot: 'bg-ink-faint',
    chip: 'bg-paper text-ink-faint border-line',
    hint: 'Consignación cerrada sin venta',
  },
  BAJA: {
    label: 'Baja',
    dot: 'bg-stale',
    chip: 'bg-stale-soft text-stale border-stale/25',
    hint: 'Fuera del sistema',
  },
};

export const OWNERSHIP_LABEL = {
  OWNED: 'Propio',
  CONSIGNMENT: 'Consignación',
} as const;

/**
 * La escala de antigüedad. 90 días es el techo de la barra porque es donde,
 * en un patio, un auto deja de ser stock y pasa a ser un problema.
 */
export const AGE_CEILING = 90;

export function ageTone(days: number) {
  if (days < 30) return { key: 'fresh', fill: 'var(--color-fresh)', text: 'text-fresh' } as const;
  if (days < 75) return { key: 'warm', fill: 'var(--color-warm)', text: 'text-warm' } as const;
  return { key: 'stale', fill: 'var(--color-stale)', text: 'text-stale' } as const;
}
