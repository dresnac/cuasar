import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Gallery } from '@/components/gallery';
import { LeadForm } from '@/components/lead-form';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { VehicleSkeleton } from '@/components/skeletons';
import { VehicleCard } from '@/components/vehicle-card';
import { brandColor, contactOf, currentAgency, seoOf } from '@/lib/agency';
import { cachedCatalog, cachedVehicle } from '@/lib/catalog';
import { FUEL_LABEL, km as fmtKm, price, TRANSMISSION_LABEL } from '@/lib/format';

export async function generateMetadata({
  params,
}: PageProps<'/u/[slug]'>): Promise<Metadata> {
  const agency = await currentAgency();
  if (!agency) return { title: 'Sitio no encontrado' };

  const { slug } = await params;
  const vehicle = await cachedVehicle(agency.agencyId, slug);
  if (!vehicle) return { title: 'Unidad no encontrada' };

  const name = `${vehicle.brand} ${vehicle.model} ${vehicle.year}`;
  const description =
    vehicle.description ??
    `${name} con ${fmtKm(vehicle.km)} en ${agency.name}. ${price(vehicle.priceCents, vehicle.priceCurrency)}.`;

  return {
    title: `${name} · ${agency.name}`,
    description,
    openGraph: {
      title: name,
      description,
      type: 'website',
      images: vehicle.images[0] ? [{ url: vehicle.images[0].url }] : undefined,
    },
  };
}

export default function VehiclePage(props: PageProps<'/u/[slug]'>) {
  return (
    <Suspense fallback={<VehicleSkeleton />}>
      <VehicleContent {...props} />
    </Suspense>
  );
}

async function VehicleContent({ params }: PageProps<'/u/[slug]'>) {
  const agency = await currentAgency();
  if (!agency) notFound();

  const { slug } = await params;
  const vehicle = await cachedVehicle(agency.agencyId, slug);
  if (!vehicle) notFound();

  const related = await cachedCatalog(agency.agencyId, { brand: vehicle.brand });
  const others = related.items.filter((v) => v.slug !== vehicle.slug).slice(0, 3);

  const name = `${vehicle.brand} ${vehicle.model}`;
  const contact = contactOf(agency);
  const seo = seoOf(agency);

  return (
    <div style={{ '--brand': brandColor(agency) } as React.CSSProperties}>
      <SiteHeader agency={agency} />

      <main className="mx-auto max-w-[1200px] px-5 py-6">
        <nav className="mb-5 text-[13px] text-ink-faint">
          <Link href="/" className="hover:text-ink">
            Stock
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink-soft">{name}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <Gallery images={vehicle.images} alt={`${name} ${vehicle.year}`} />

            {vehicle.description && (
              <section className="mt-8">
                <h2 className="font-display text-[17px] font-semibold tracking-tight">
                  Sobre esta unidad
                </h2>
                <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
                  {vehicle.description}
                </p>
              </section>
            )}

            {vehicle.features.length > 0 && (
              <section className="mt-8">
                <h2 className="font-display text-[17px] font-semibold tracking-tight">
                  Equipamiento
                </h2>
                <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[14px] text-ink-soft sm:grid-cols-3">
                  {vehicle.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-8">
              <h2 className="font-display text-[17px] font-semibold tracking-tight">Ficha</h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 sm:grid-cols-4">
                <Spec label="Año" value={String(vehicle.year)} />
                <Spec label="Kilómetros" value={fmtKm(vehicle.km)} />
                {vehicle.fuel && (
                  <Spec label="Combustible" value={FUEL_LABEL[vehicle.fuel] ?? vehicle.fuel} />
                )}
                {vehicle.transmission && (
                  <Spec
                    label="Transmisión"
                    value={TRANSMISSION_LABEL[vehicle.transmission] ?? vehicle.transmission}
                  />
                )}
                {vehicle.color && <Spec label="Color" value={vehicle.color} />}
                {vehicle.doors && <Spec label="Puertas" value={String(vehicle.doors)} />}
              </dl>
            </section>
          </div>

          <aside className="lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-xl border border-line p-5">
              <h1 className="font-display text-[22px] font-semibold leading-tight tracking-tight">
                {name}
              </h1>
              {vehicle.version && (
                <p className="mt-0.5 text-[14px] text-ink-soft">{vehicle.version}</p>
              )}

              <p className="spec-strip mt-2 text-[13px] text-ink-soft">
                <span>{vehicle.year}</span>
                <span>{fmtKm(vehicle.km)}</span>
                {vehicle.transmission && (
                  <span>{TRANSMISSION_LABEL[vehicle.transmission] ?? vehicle.transmission}</span>
                )}
              </p>

              <p className="tabular mt-4 font-display text-[30px] font-semibold leading-none tracking-tight">
                {price(vehicle.priceCents, vehicle.priceCurrency)}
              </p>

              {contact.phone && (
                <a
                  href={`tel:${contact.phone.replace(/\s/g, '')}`}
                  className="mt-4 flex h-11 items-center justify-center rounded-lg border text-[15px] font-medium"
                  style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
                >
                  Llamar {contact.phone}
                </a>
              )}
            </div>

            <div className="mt-4">
              <LeadForm vehicleSlug={vehicle.slug} vehicleName={`${name} ${vehicle.year}`} />
            </div>
          </aside>
        </div>

        {others.length > 0 && (
          <section className="mt-16">
            <h2 className="font-display text-[18px] font-semibold tracking-tight">
              Otros {vehicle.brand} en {agency.name}
            </h2>
            <ul className="mt-4 grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-3">
              {others.map((other) => (
                <li key={other.slug}>
                  <VehicleCard vehicle={other} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <SiteFooter agency={agency} />

      {/* Datos estructurados: es lo que hace que la unidad aparezca bien en
          una búsqueda, que es de donde llega buena parte del tráfico. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Car',
            name: `${name} ${vehicle.year}`,
            brand: { '@type': 'Brand', name: vehicle.brand },
            model: vehicle.model,
            vehicleModelDate: String(vehicle.year),
            mileageFromOdometer: { '@type': 'QuantitativeValue', value: vehicle.km, unitCode: 'KMT' },
            image: vehicle.images.map((i) => i.url),
            description: vehicle.description ?? seo.description,
            offers: {
              '@type': 'Offer',
              price: Number(vehicle.priceCents) / 100,
              priceCurrency: vehicle.priceCurrency,
              availability: 'https://schema.org/InStock',
              seller: { '@type': 'AutoDealer', name: agency.name },
            },
          }),
        }}
      />
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line py-2.5">
      <dt className="text-[12px] uppercase tracking-[0.1em] text-ink-faint">{label}</dt>
      <dd className="tabular mt-0.5 text-[15px]">{value}</dd>
    </div>
  );
}
