import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canSeeFinancials, type VehicleStatus } from '@cuasar/core';
import { getSale, getVehicle, listCosts, listTimeline } from '@cuasar/core/services';
import { AgeBar } from '@/components/age-bar';
import { CostsCard } from '@/components/costs-card';
import { ImageUploader } from '@/components/image-uploader';
import { NoteForm } from '@/components/note-form';
import { Plate } from '@/components/plate';
import { SaleCard } from '@/components/sale-card';
import { StatusChip } from '@/components/status-chip';
import { Timeline } from '@/components/timeline';
import { TransitionControl } from '@/components/transition-control';
import { Card, SectionTitle } from '@/components/ui';
import { OWNERSHIP_LABEL } from '@/components/vehicle-meta';
import { dateLong, km as fmtKm, money, relativeDays } from '@/lib/format';
import { agencyTeam, requireSession } from '@/lib/tenant';

export default async function VehiclePage({ params }: PageProps<'/vehiculos/[id]'>) {
  const { id } = await params;
  const session = await requireSession();

  const vehicle = await getVehicle(session.ctx, id);
  if (!vehicle) notFound();

  const showMoney = canSeeFinancials(session.ctx.role);

  const [timeline, costs, sale, team] = await Promise.all([
    listTimeline(session.ctx, id),
    listCosts(session.ctx, id),
    getSale(session.ctx, id),
    showMoney ? agencyTeam(session.agency.agencyId) : Promise.resolve([]),
  ]);
  const editable = session.access === 'FULL';
  const base = session.agency.baseCurrency;
  const sold = vehicle.status === 'VENDIDO';

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-[13px] text-ink-faint">
        <Link href="/vehiculos" className="hover:text-ink">
          Vehículos
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-soft">
          {vehicle.brand} {vehicle.model}
        </span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {vehicle.brand} {vehicle.model}
            </h1>
            <Plate value={vehicle.licensePlate} />
          </div>
          <p className="mt-1 text-[14px] text-ink-soft">
            {[vehicle.version, vehicle.year, fmtKm(vehicle.km), vehicle.color]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="text-right">
          <p className="tabular font-display text-2xl font-semibold tracking-tight">
            {money(vehicle.listPriceAmountCents, vehicle.listPriceCurrency)}
          </p>
          {vehicle.floorPriceCents !== null && (
            <p className="tabular text-[12px] text-ink-soft">
              piso {money(vehicle.floorPriceCents, base)}
            </p>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <Card className="p-4">
            <SectionTitle eyebrow="Estado">
              {sold ? 'Operación cerrada' : 'Dónde está la unidad'}
            </SectionTitle>

            <div className="mb-4 flex flex-wrap items-center gap-4">
              <StatusChip status={vehicle.status as VehicleStatus} />
              <span className="text-[13px] text-ink-soft">
                {OWNERSHIP_LABEL[vehicle.ownership as 'OWNED' | 'CONSIGNMENT']}
              </span>
              <span className="text-[13px] text-ink-faint">
                en este estado desde {relativeDays(vehicle.daysInStatus)}
              </span>
            </div>

            <div className="mb-4 max-w-sm">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[12px] text-ink-soft">
                  {sold ? 'Tardó en venderse' : 'En el patio desde'}
                </span>
                <span className="tabular text-[12px] text-ink-soft">
                  {dateLong(vehicle.acquiredAt)}
                </span>
              </div>
              <AgeBar days={vehicle.daysInStock} sold={sold} />
            </div>

            <TransitionControl
              vehicleId={vehicle.id}
              status={vehicle.status as VehicleStatus}
              disabled={!editable}
            />
          </Card>

          <Card className="p-4">
            <SectionTitle eyebrow={`${vehicle.images.length} de 40`}>Fotos</SectionTitle>
            <ImageUploader
              vehicleId={vehicle.id}
              agencySlug={session.agency.agencySlug}
              images={vehicle.images.map((i) => ({
                id: i.id,
                blobUrl: i.blobUrl,
                width: i.width,
                height: i.height,
                isCover: i.isCover,
              }))}
              editable={editable}
            />
          </Card>

          {vehicle.description && (
            <Card className="p-4">
              <SectionTitle eyebrow="Ficha">Descripción</SectionTitle>
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-soft">
                {vehicle.description}
              </p>
            </Card>
          )}

          {vehicle.consignment && (
            <Card className="p-4">
              <SectionTitle eyebrow="Consignación">Contrato con el dueño</SectionTitle>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-3">
                <Detail label="Dueño" value={vehicle.consignment.consignorName} />
                <Detail label="Teléfono" value={vehicle.consignment.consignorPhone ?? '—'} />
                <Detail
                  label="Piso acordado"
                  value={money(
                    vehicle.consignment.agreedFloorAmountCents,
                    vehicle.consignment.agreedFloorCurrency,
                  )}
                />
                <Detail
                  label="Comisión"
                  value={
                    vehicle.consignment.commissionType === 'PCT'
                      ? `${vehicle.consignment.commissionValue}%`
                      : money(BigInt(Math.round(Number(vehicle.consignment.commissionValue))), base)
                  }
                />
                <Detail label="Desde" value={vehicle.consignment.contractStartsAt} />
                <Detail label="Hasta" value={vehicle.consignment.contractEndsAt ?? 'sin plazo'} />
              </dl>
            </Card>
          )}

          {showMoney && (
            <Card className="p-4">
              <SectionTitle eyebrow="Preparación">Gastos de la unidad</SectionTitle>
              <CostsCard
                vehicleId={vehicle.id}
                costs={costs}
                baseCurrency={base}
                editable={editable}
              />
            </Card>
          )}

          {showMoney && (
            <Card className="p-4">
              <SectionTitle eyebrow={sold ? 'Operación' : 'Venta'}>
                {sold ? 'Cómo se cerró' : 'Cerrar la operación'}
              </SectionTitle>
              <SaleCard
                vehicleId={vehicle.id}
                sale={sale}
                sellable={vehicle.status === 'PUBLICADO' || vehicle.status === 'RESERVADO'}
                editable={editable}
                baseCurrency={base}
                floorBaseCents={vehicle.consignment?.agreedFloorAmountBaseCents ?? null}
                team={team}
              />
            </Card>
          )}

          {showMoney && vehicle.financials && (
            <Card className="p-4">
              <SectionTitle eyebrow="Contabilidad">Resultado de la unidad</SectionTitle>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-4">
                {vehicle.ownership === 'OWNED' && (
                  <Detail
                    label="Compra"
                    value={money(vehicle.financials.acquisitionBaseCents, base)}
                  />
                )}
                <Detail label="Gastos" value={money(vehicle.financials.costsBaseCents, base)} />
                {vehicle.ownership === 'CONSIGNMENT' && (
                  <Detail
                    label="Comisión"
                    value={money(vehicle.financials.commissionBaseCents, base)}
                  />
                )}
                <Detail
                  label="Venta"
                  value={
                    vehicle.financials.saleBaseCents === null
                      ? 'sin vender'
                      : money(vehicle.financials.saleBaseCents, base)
                  }
                />
                <Detail
                  label="Margen"
                  tone={
                    vehicle.financials.grossMarginBaseCents === null
                      ? undefined
                      : vehicle.financials.grossMarginBaseCents >= 0n
                        ? 'fresh'
                        : 'stale'
                  }
                  value={
                    vehicle.financials.grossMarginBaseCents === null
                      ? '—'
                      : `${money(vehicle.financials.grossMarginBaseCents, base)}${
                          vehicle.financials.marginPct
                            ? ` · ${Number(vehicle.financials.marginPct).toFixed(1)}%`
                            : ''
                        }`
                  }
                />
              </dl>
              <p className="mt-3 border-t border-line pt-3 text-[12px] text-ink-faint">
                {vehicle.ownership === 'CONSIGNMENT'
                  ? 'En consignación el capital es del dueño: el resultado es la comisión menos los gastos que puso la agencia.'
                  : 'Venta menos compra menos gastos, en la moneda base de la agencia.'}
              </p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <Card className="p-4">
            <SectionTitle eyebrow="Historial">Todo lo que pasó</SectionTitle>
            <NoteForm vehicleId={vehicle.id} disabled={!editable} />
            <div className="mt-4 border-t border-line pt-1">
              {timeline.ok && <Timeline entries={timeline.data.entries} />}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'fresh' | 'stale';
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.1em] text-ink-faint">{label}</dt>
      <dd
        className={`tabular mt-0.5 font-medium ${
          tone === 'fresh' ? 'text-fresh' : tone === 'stale' ? 'text-stale' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
