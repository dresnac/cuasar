import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import {
  getCatalogFacets,
  getPublicVehicle,
  listCatalog,
  listCatalogSlugs,
} from '@cuasar/core/services';

/**
 * Lecturas cacheadas del catálogo.
 *
 * El sitio público tiene que aguantar un pico de tráfico —una publicación
 * que se comparte, un bot que rastrea— sin que eso se traduzca en un pico de
 * consultas a la base. Todo lo que se lee acá se cachea por agencia y se
 * invalida por tag cuando la agencia publica, despublica o cambia un precio
 * (ver /api/revalidate).
 *
 * Las funciones cacheadas no pueden leer headers ni cookies: el `agencyId`
 * llega siempre como argumento, que además es lo que las separa por tenant
 * dentro del caché.
 */

export const catalogTag = (agencyId: string) => `catalogo:${agencyId}`;

export async function cachedCatalog(agencyId: string, filters: Record<string, unknown>) {
  'use cache';
  cacheTag(catalogTag(agencyId));
  cacheLife('hours');

  return listCatalog(agencyId, filters);
}

export async function cachedVehicle(agencyId: string, slug: string) {
  'use cache';
  cacheTag(catalogTag(agencyId));
  cacheLife('hours');

  return getPublicVehicle(agencyId, slug);
}

export async function cachedFacets(agencyId: string) {
  'use cache';
  cacheTag(catalogTag(agencyId));
  cacheLife('hours');

  return getCatalogFacets(agencyId);
}

export async function cachedSlugs(agencyId: string) {
  'use cache';
  cacheTag(catalogTag(agencyId));
  cacheLife('hours');

  return listCatalogSlugs(agencyId);
}
