import type { MetadataRoute } from 'next';
import { currentAgency } from '@/lib/agency';
import { cachedSlugs } from '@/lib/catalog';

/**
 * Un sitemap por agencia. Se arma desde el host del request, así que cada
 * dominio publica el suyo y ninguno expone las unidades de otro.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const agency = await currentAgency();
  if (!agency) return [];

  const base = agency.publicDomain
    ? `https://${agency.publicDomain}`
    : `https://${agency.slug}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'cuasar.app'}`;

  const slugs = await cachedSlugs(agency.agencyId);

  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
    ...slugs.map((v) => ({
      url: `${base}/u/${v.slug}`,
      lastModified: v.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
