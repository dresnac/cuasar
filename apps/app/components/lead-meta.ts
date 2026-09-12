import type { LeadStatus } from '@cuasar/core/services';

/**
 * Cómo se lee cada estado de una consulta.
 *
 * Vive en un módulo sin `'use client'` a propósito: lo usan la página (que es
 * un componente de servidor) y la tarjeta (que es de cliente). Un objeto
 * exportado desde un módulo de cliente no llega al servidor —Next lo reemplaza
 * por una referencia— y el acceso devuelve undefined sin avisar.
 */
export const LEAD_STATUS_META: Record<LeadStatus, { label: string; chip: string }> = {
  NEW: { label: 'Sin atender', chip: 'bg-signal-soft text-signal border-signal/25' },
  CONTACTED: { label: 'Contactado', chip: 'bg-warm-soft text-warm border-warm/30' },
  QUALIFIED: { label: 'Con visita', chip: 'bg-paper text-ink-soft border-line-strong' },
  WON: { label: 'Vendido', chip: 'bg-fresh-soft text-fresh border-fresh/25' },
  LOST: { label: 'Perdido', chip: 'bg-paper text-ink-faint border-line' },
};

export const LEAD_SOURCE_LABEL: Record<string, string> = {
  PUBLIC_SITE: 'del sitio',
  WHATSAPP: 'por WhatsApp',
  MELI: 'de MercadoLibre',
  PHONE: 'por teléfono',
  MANUAL: 'cargada a mano',
};
