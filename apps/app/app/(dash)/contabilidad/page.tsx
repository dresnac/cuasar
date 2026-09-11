import Link from 'next/link';
import { getDashboard } from '@cuasar/core/services';
import { AgingChart } from '@/components/aging-chart';
import { CostBreakdown } from '@/components/cost-breakdown';
import { MonthlyMarginChart } from '@/components/monthly-margin-chart';
import { StatTile } from '@/components/stat-tile';
import { Card, Empty, SectionTitle, cx } from '@/components/ui';
import { money } from '@/lib/format';
import { requireSession } from '@/lib/tenant';

export const metadata = { title: 'Contabilidad' };

const PERIODS = [
  { key: '30', label: '30 días' },
  { key: '90', label: '90 días' },
  { key: '365', label: '12 meses' },
  { key: 'ytd', label: 'Este año' },
] as const;

export default async function AccountingPage({ searchParams }: PageProps<'/contabilidad'>) {
  const session = await requireSession();
  const params = await searchParams;
  const periodKey = typeof params.periodo === 'string' ? params.periodo : '90';

  const { from, to } = resolvePeriod(periodKey);
  const base = session.agency.baseCurrency;

  const result = await getDashboard(session.ctx, { from, to }, base);

  if (!result.ok) {
    return (
      <Empty title="Sección restringida">
        {result.error.message} Si necesitás verla, pedile a un administrador que cambie tu rol.
      </Empty>
    );
  }

  const { portfolio, aging, period, monthly, bySalesperson, byCostCategory } = result.data;
  const inStock = portfolio.ownedCount + portfolio.consignmentCount;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Contabilidad</h1>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            Todo en {base}, con la cotización que tenía cada operación el día que se registró.
          </p>
        </div>

        <nav aria-label="Período" className="flex gap-1">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/contabilidad?periodo=${p.key}`}
              aria-current={p.key === periodKey ? 'true' : undefined}
              className={cx(
                'rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
                p.key === periodKey
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line-strong bg-surface text-ink-soft hover:border-ink/40 hover:text-ink',
              )}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>

      <section aria-label="Resumen" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Capital inmovilizado"
          value={money(portfolio.capitalTiedBaseCents, base)}
          hint={`${portfolio.ownedCount} ${portfolio.ownedCount === 1 ? 'unidad propia' : 'unidades propias'} en el patio. Las ${portfolio.consignmentCount} en consignación no cuentan: ese capital es del dueño.`}
        />
        <StatTile
          label="Margen del período"
          value={money(period.marginBaseCents, base)}
          tone={period.marginBaseCents >= 0n ? 'fresh' : 'stale'}
          hint={
            period.marginPct === null
              ? 'Sin ventas cerradas todavía'
              : `${period.marginPct.toFixed(1)}% de ${money(period.revenueBaseCents, base)} facturados`
          }
        />
        <StatTile
          label="Unidades vendidas"
          value={String(period.unitsSold)}
          hint={
            period.unitsSold === 0
              ? 'En el período elegido'
              : `${period.owned.units} propias y ${period.consignment.units} en consignación. Tardaron ${period.avgDaysToSell} días en promedio.`
          }
        />
        <StatTile
          label="Antigüedad promedio"
          value={`${portfolio.avgDaysInStock} días`}
          tone={portfolio.avgDaysInStock >= 75 ? 'stale' : portfolio.avgDaysInStock >= 30 ? 'warm' : 'neutral'}
          hint={
            inStock === 0
              ? 'Sin unidades en stock'
              : `La más vieja lleva ${portfolio.oldestDays} días. Promedio de ${inStock} unidades.`
          }
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <SectionTitle eyebrow="Últimos 12 meses">Margen realizado por mes</SectionTitle>
          <MonthlyMarginChart data={monthly} baseCurrency={base} />
        </Card>

        <Card className="p-4">
          <SectionTitle eyebrow={`${inStock} en stock`}>Antigüedad del patio</SectionTitle>
          <AgingChart buckets={aging} baseCurrency={base} />
          <p className="mt-3 border-t border-line pt-3 text-[12px] text-ink-faint">
            Los gastos de preparación de las unidades en stock suman{' '}
            {money(portfolio.costsInStockBaseCents, base)}.
          </p>
        </Card>

        <Card className="p-4">
          <SectionTitle eyebrow="En el período">Resultado por vendedor</SectionTitle>
          {bySalesperson.length === 0 ? (
            <p className="text-[13px] text-ink-soft">Sin ventas cerradas en el período.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                  <th scope="col" className="pb-2 font-medium">Vendedor</th>
                  <th scope="col" className="pb-2 text-right font-medium">Unidades</th>
                  <th scope="col" className="pb-2 text-right font-medium">Facturado</th>
                  <th scope="col" className="pb-2 text-right font-medium">Margen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bySalesperson.map((row) => (
                  <tr key={row.userId ?? row.name}>
                    <td className="py-2">{row.name}</td>
                    <td className="tabular py-2 text-right">{row.unitsSold}</td>
                    <td className="tabular py-2 text-right">
                      {money(row.revenueBaseCents, base)}
                    </td>
                    <td
                      className={cx(
                        'tabular py-2 text-right font-medium',
                        row.marginBaseCents >= 0n ? 'text-fresh' : 'text-stale',
                      )}
                    >
                      {money(row.marginBaseCents, base)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle eyebrow="En el período">En qué se fue la preparación</SectionTitle>
          <CostBreakdown rows={byCostCategory} baseCurrency={base} />
        </Card>
      </div>

      <p className="text-[12px] text-ink-faint">
        En consignación el resultado es la comisión menos los gastos que puso la agencia; el precio
        del auto no entra porque el capital no es suyo. En unidades propias es venta menos compra
        menos gastos.
      </p>
    </div>
  );
}

function resolvePeriod(key: string) {
  const to = new Date();

  if (key === 'ytd') {
    return { from: new Date(Date.UTC(to.getUTCFullYear(), 0, 1)), to };
  }

  const days = Number(key);
  const span = Number.isFinite(days) && days > 0 ? days : 90;
  return { from: new Date(to.getTime() - span * 86_400_000), to };
}
