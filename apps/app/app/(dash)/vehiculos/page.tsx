import Link from 'next/link';
import { canSeeFinancials } from '@cuasar/core';
import { listBrands, listVehicles } from '@cuasar/core/services';
import { buttonClass, Card, Empty } from '@/components/ui';
import { VehicleFilters } from '@/components/vehicle-filters';
import { VehicleRow } from '@/components/vehicle-row';
import { requireSession } from '@/lib/tenant';

export const metadata = { title: 'Vehículos' };

export default async function VehiclesPage({ searchParams }: PageProps<'/vehiculos'>) {
  const session = await requireSession();
  const params = await searchParams;

  const [result, brands] = await Promise.all([
    listVehicles(session.ctx, {
      status: toArray(params.status),
      ownership: params.ownership,
      brand: params.brand,
      q: params.q,
      sort: params.sort,
      cursor: params.cursor,
    }),
    listBrands(session.ctx),
  ]);

  if (!result.ok) {
    return <Empty title="No pudimos leer el stock">{result.error.message}</Empty>;
  }

  const { items, nextCursor } = result.data;
  const showMoney = canSeeFinancials(session.ctx.role);
  const parado = items.filter((v) => v.daysInStock >= 75 && v.status !== 'VENDIDO').length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Vehículos</h1>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            {items.length === 0
              ? 'Todavía no hay unidades cargadas'
              : `${items.length} ${items.length === 1 ? 'unidad' : 'unidades'} en esta vista`}
            {parado > 0 && (
              <>
                {' · '}
                <span className="text-stale">
                  {parado} {parado === 1 ? 'lleva' : 'llevan'} más de 75 días
                </span>
              </>
            )}
          </p>
        </div>

        <Link href="/vehiculos/nuevo" className={buttonClass('primary', 'md', 'shrink-0')}>
          Cargar vehículo
        </Link>
      </header>

      <VehicleFilters brands={brands} />

      {items.length === 0 ? (
        <Empty
          title="Sin resultados"
          action={
            <Link
              href="/vehiculos"
              className="text-[13px] text-signal underline underline-offset-4"
            >
              Quitar los filtros
            </Link>
          }
        >
          Ningún vehículo coincide con lo que buscaste. Probá con menos filtros, o cargá la primera
          unidad del patio.
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {items.map((vehicle) => (
              <VehicleRow
                key={vehicle.id}
                vehicle={vehicle}
                showMoney={showMoney}
                baseCurrency={session.agency.baseCurrency}
              />
            ))}
          </ul>
        </Card>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Link
            href={{ pathname: '/vehiculos', query: { ...params, cursor: nextCursor } }}
            className="rounded-lg border border-line-strong bg-surface px-4 py-2 text-[13px] font-medium hover:border-ink/40"
          >
            Ver más
          </Link>
        </div>
      )}
    </div>
  );
}

function toArray(value: string | string[] | undefined) {
  if (!value) return undefined;
  return Array.isArray(value) ? value : [value];
}
