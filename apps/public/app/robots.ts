import type { MetadataRoute } from 'next';
import { currentAgency } from '@/lib/agency';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const agency = await currentAgency();

  // Un host que no resuelve a ninguna agencia no debería indexarse: si no
  // hay sitio, no hay nada que ofrecerle a un buscador.
  if (!agency) return { rules: { userAgent: '*', disallow: '/' } };

  const base = agency.publicDomain
    ? `https://${agency.publicDomain}`
    : `https://${agency.slug}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'cuasar.app'}`;

  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${base}/sitemap.xml`,
  };
}
