import Image from 'next/image';
import Link from 'next/link';
import type { VehicleListItem } from '@cuasar/core/services';
import { AgeBar } from './age-bar';
import { Plate } from './plate';
import { StatusChip } from './status-chip';
import { OWNERSHIP_LABEL } from './vehicle-meta';
import { km as fmtKm, money } from '@/lib/format';

export function VehicleRow({
  vehicle,
  showMoney,
  baseCurrency,
}: {
  vehicle: VehicleListItem;
  showMoney: boolean;
  baseCurrency: string;
}) {
  const sold = vehicle.status === 'VENDIDO';

  return (
    <li className="group border-b border-line last:border-0">
      <Link
        href={`/vehiculos/${vehicle.id}`}
        className="grid grid-cols-[72px_1fr] items-center gap-3 px-3 py-3 transition-colors hover:bg-paper sm:grid-cols-[88px_minmax(0,1fr)_auto] sm:gap-4 sm:px-4"
      >
        <div className="relative aspect-4/3 overflow-hidden rounded-md bg-paper">
          {vehicle.coverUrl ? (
            <Image
              src={vehicle.coverUrl}
              alt=""
              fill
              sizes="88px"
              className="object-cover"
            />
          ) : (
            <span className="grid h-full place-items-center text-[10px] text-ink-faint">
              sin foto
            </span>
          )}
          {vehicle.imageCount > 1 && (
            <span className="tabular absolute bottom-0.5 right-0.5 rounded bg-ink/75 px-1 text-[10px] font-medium text-paper">
              {vehicle.imageCount}
            </span>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-display text-[15px] font-semibold leading-tight tracking-tight">
              {vehicle.brand} {vehicle.model}
            </h3>
            {vehicle.version && (
              <span className="truncate text-[13px] text-ink-soft">{vehicle.version}</span>
            )}
          </div>

          <p className="tabular mt-0.5 text-[12px] text-ink-soft">
            {vehicle.year} · {fmtKm(vehicle.km)}
            {vehicle.ownership === 'CONSIGNMENT' && (
              <span className="ml-2 text-ink-faint">{OWNERSHIP_LABEL.CONSIGNMENT}</span>
            )}
          </p>

          <div className="mt-2 flex items-center gap-2.5 sm:hidden">
            <StatusChip status={vehicle.status} size="sm" />
            <AgeBar days={vehicle.daysInStock} sold={sold} />
          </div>
        </div>

        <div className="hidden items-center gap-5 sm:flex">
          <div className="w-24">
            <AgeBar days={vehicle.daysInStock} sold={sold} />
          </div>

          <div className="w-32">
            <StatusChip status={vehicle.status} size="sm" />
          </div>

          <div className="w-32 text-right">
            <p className="tabular font-display text-[15px] font-semibold tracking-tight">
              {money(vehicle.listPriceAmountCents, vehicle.listPriceCurrency)}
            </p>
            {showMoney && vehicle.marginBaseCents !== null && (
              <p
                className={`tabular text-[12px] ${
                  vehicle.marginBaseCents >= 0n ? 'text-fresh' : 'text-stale'
                }`}
              >
                {vehicle.marginBaseCents >= 0n ? '+' : ''}
                {money(vehicle.marginBaseCents, baseCurrency)}
              </p>
            )}
            {showMoney && vehicle.marginBaseCents === null && vehicle.investedBaseCents !== null && (
              <p className="tabular text-[12px] text-ink-faint">
                invertido {money(vehicle.investedBaseCents, baseCurrency)}
              </p>
            )}
          </div>

          <div className="w-[5.5rem] shrink-0">
            <Plate value={vehicle.licensePlate} size="sm" />
          </div>
        </div>
      </Link>
    </li>
  );
}
