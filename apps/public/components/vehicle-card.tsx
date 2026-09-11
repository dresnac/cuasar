import Image from 'next/image';
import Link from 'next/link';
import type { CatalogItem } from '@cuasar/core/services';
import { FUEL_LABEL, km as fmtKm, price, TRANSMISSION_LABEL } from '@/lib/format';

export function VehicleCard({ vehicle, priority }: { vehicle: CatalogItem; priority?: boolean }) {
  const cover = vehicle.images[0];

  return (
    <article className="group">
      <Link href={`/u/${vehicle.slug}`} className="block">
        <div className="relative aspect-4/3 overflow-hidden rounded-xl bg-muted">
          {cover ? (
            <Image
              src={cover.url}
              alt={`${vehicle.brand} ${vehicle.model} ${vehicle.year}`}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 380px"
              priority={priority}
              placeholder={cover.blur ? 'blur' : 'empty'}
              blurDataURL={cover.blur ?? undefined}
              className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <span className="grid h-full place-items-center text-[13px] text-ink-faint">
              Sin fotos
            </span>
          )}

          {vehicle.imageCount > 1 && (
            <span className="tabular absolute bottom-2 right-2 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] font-medium text-white">
              {vehicle.imageCount} fotos
            </span>
          )}
        </div>

        <div className="mt-3">
          <h3 className="font-display text-[16px] font-semibold leading-tight tracking-tight">
            {vehicle.brand} {vehicle.model}
          </h3>
          {vehicle.version && (
            <p className="mt-0.5 truncate text-[13px] text-ink-soft">{vehicle.version}</p>
          )}

          <p className="spec-strip mt-1.5 text-[13px] text-ink-soft">
            <span>{vehicle.year}</span>
            <span>{fmtKm(vehicle.km)}</span>
            {vehicle.fuel && <span>{FUEL_LABEL[vehicle.fuel] ?? vehicle.fuel}</span>}
            {vehicle.transmission && (
              <span>{TRANSMISSION_LABEL[vehicle.transmission] ?? vehicle.transmission}</span>
            )}
          </p>

          <p className="tabular mt-2 font-display text-[19px] font-semibold tracking-tight">
            {price(vehicle.priceCents, vehicle.priceCurrency)}
          </p>
        </div>
      </Link>
    </article>
  );
}
