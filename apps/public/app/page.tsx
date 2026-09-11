import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CatalogFilters } from '@/components/catalog-filters';
import { LeadForm } from '@/components/lead-form';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { CatalogSkeleton } from '@/components/skeletons';
import { VehicleCard } from '@/components/vehicle-card';
import { brandColor, currentAgency, seoOf } from '@/lib/agency';
import { cachedCatalog, cachedFacets } from '@/lib/catalog';

export async function generateMetadata(): Promise<Metadata> {
  const agency = await currentAgency();
  if (!agency) return { title: 'Sitio no encontrado' };

  const seo = seoOf(agency);
  return {
    title: seo.title,
    description: seo.description,
    openGraph: { title: seo.title, description: seo.description, type: 'website' },
  };
}

/**
 * Qué agencia es este sitio depende del header Host, así que el contenido no
 * se puede prerenderizar: se renderiza por request, dentro de un límite de
 * Suspense. Lo que sí se cachea —y es lo que importa— son las consultas al
 * catálogo (ver lib/catalog.ts).
 */
export default function CatalogPage(props: PageProps<'/'>) {
  return (
    <Suspense fallback={<CatalogSkeleton />}>
      <CatalogContent {...props} />
    </Suspense>
  );
}

async function CatalogContent({ searchParams }: PageProps<'/'>) {
  const agency = await currentAgency();
  if (!agency) notFound();

  const params = await searchParams;
  const [catalog, facets] = await Promise.all([
    cachedCatalog(agency.agencyId, {
      q: params.q,
      brand: params.brand,
      sort: params.sort,
      page: params.page,
    }),
    cachedFacets(agency.agencyId),
  ]);

  return (
    <div style={{ '--brand': brandColor(agency) } as React.CSSProperties}>
      <SiteHeader agency={agency} />

      <main className="mx-auto max-w-[1200px] px-5 py-8">
        <div className="mb-6 flex flex-col gap-4">
          <div>
            <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">
              {catalog.total === 0
                ? 'Todavía no hay unidades publicadas'
                : `${catalog.total} ${catalog.total === 1 ? 'unidad disponible' : 'unidades disponibles'}`}
            </h1>
            <p className="mt-1 text-[15px] text-ink-soft">{seoOf(agency).description}</p>
          </div>

          {facets.brands.length > 0 && <CatalogFilters brands={facets.brands} />}
        </div>

        {catalog.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong px-6 py-16 text-center">
            <p className="font-display text-[18px] font-semibold tracking-tight">
              Sin resultados
            </p>
            <p className="mt-1 text-[15px] text-ink-soft">
              Probá con otra marca, o escribinos y te avisamos cuando entre algo así.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block text-[14px] underline underline-offset-4"
              style={{ color: 'var(--brand)' }}
            >
              Ver todo el stock
            </Link>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-3">
            {catalog.items.map((vehicle, i) => (
              <li key={vehicle.slug}>
                <VehicleCard vehicle={vehicle} priority={i < 3} />
              </li>
            ))}
          </ul>
        )}

        {catalog.pages > 1 && (
          <nav aria-label="Paginación" className="mt-10 flex justify-center gap-2">
            {Array.from({ length: catalog.pages }, (_, i) => i + 1).map((n) => (
              <Link
                key={n}
                href={{ pathname: '/', query: { ...params, page: n } }}
                aria-current={n === catalog.page ? 'page' : undefined}
                className="tabular grid size-9 place-items-center rounded-lg border text-[14px]"
                style={
                  n === catalog.page
                    ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: 'white' }
                    : { borderColor: 'var(--color-line-strong)' }
                }
              >
                {n}
              </Link>
            ))}
          </nav>
        )}

        <section className="mt-16 max-w-md">
          <LeadForm vehicleSlug={null} />
        </section>
      </main>

      <SiteFooter agency={agency} />
    </div>
  );
}
