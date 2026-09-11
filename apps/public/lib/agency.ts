import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { cacheLife, cacheTag } from 'next/cache';
import { getPublicAgencyById, type PublicAgency } from '@cuasar/core/services';

/**
 * Qué agencia es este sitio.
 *
 * El middleware ya resolvió el dominio y dejó el id en `x-agency-id`; acá
 * solo se traen nombre, branding y contacto, cacheados por agencia. Si el
 * header no está, el request no pasó por el middleware y no hay sitio.
 */
export const currentAgency = cache(async (): Promise<PublicAgency | null> => {
  const headerList = await headers();
  const agencyId = headerList.get('x-agency-id');
  if (!agencyId) return null;

  return cachedAgency(agencyId);
});

export const agencyTag = (agencyId: string) => `agencia:${agencyId}`;

async function cachedAgency(agencyId: string) {
  'use cache';
  cacheTag(agencyTag(agencyId));
  cacheLife('hours');

  return getPublicAgencyById(agencyId);
}

export function brandColor(agency: PublicAgency): string {
  const primary = agency.branding?.primary;
  return typeof primary === 'string' && /^#[0-9a-f]{6}$/i.test(primary) ? primary : '#16181d';
}

export function contactOf(agency: PublicAgency) {
  const c = agency.contact ?? {};
  return {
    phone: typeof c.phone === 'string' ? c.phone : null,
    whatsapp: typeof c.whatsapp === 'string' ? c.whatsapp : null,
    address: typeof c.address === 'string' ? c.address : null,
    city: typeof c.city === 'string' ? c.city : null,
    hours: typeof c.hours === 'string' ? c.hours : null,
  };
}

export function seoOf(agency: PublicAgency) {
  const s = agency.seo ?? {};
  return {
    title: typeof s.title === 'string' ? s.title : agency.name,
    description:
      typeof s.description === 'string'
        ? s.description
        : `Autos usados seleccionados en ${agency.name}.`,
  };
}
