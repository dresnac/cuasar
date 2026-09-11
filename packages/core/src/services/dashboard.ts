import { sql, withTenant, type TenantCtx } from '@cuasar/db';
import { fail, ok, type Result } from '../errors';
import { canSeeFinancials } from '../permissions';

/**
 * Dashboard contable.
 *
 * Todo sale de `vehicle_financials`, la proyección que mantienen los
 * triggers: ninguna de estas consultas agrega costos fila por fila en vivo.
 *
 * Dos reglas que atraviesan el módulo entero:
 *
 * 1. Propio y consignación se cuentan por separado, siempre. El capital
 *    inmovilizado de un auto en consignación es del dueño, no de la agencia;
 *    sumarlos da un número que parece correcto y no lo es.
 * 2. Los montos están en la moneda base de la agencia. Cada operación guardó
 *    su cotización al registrarse, así que este número no se mueve cuando se
 *    mueve el dólar.
 *
 * Las lecturas crudas devuelven los bigint de Postgres como string: se
 * convierten explícitamente acá abajo y nunca se comparan sin convertir.
 */

const big = (v: unknown): bigint => BigInt(String(v ?? '0'));
const num = (v: unknown): number => Number(v ?? 0);

export type Portfolio = {
  ownedCount: number;
  consignmentCount: number;
  /** Solo unidades propias en stock: plata de la agencia parada en el patio. */
  capitalTiedBaseCents: bigint;
  costsInStockBaseCents: bigint;
  avgDaysInStock: number;
  oldestDays: number;
};

export type AgeBucket = {
  label: string;
  from: number;
  to: number | null;
  units: number;
  capitalBaseCents: bigint;
};

export type PeriodResult = {
  unitsSold: number;
  revenueBaseCents: bigint;
  marginBaseCents: bigint;
  marginPct: number | null;
  avgDaysToSell: number;
  owned: { units: number; marginBaseCents: bigint };
  consignment: { units: number; marginBaseCents: bigint };
};

export type MonthlyPoint = {
  month: string;
  unitsSold: number;
  revenueBaseCents: bigint;
  marginBaseCents: bigint;
};

export type SalespersonRow = {
  userId: string | null;
  name: string;
  unitsSold: number;
  revenueBaseCents: bigint;
  marginBaseCents: bigint;
};

export type CostCategoryRow = {
  category: string;
  amountBaseCents: bigint;
  entries: number;
};

export type Dashboard = {
  from: Date;
  to: Date;
  baseCurrency: string;
  portfolio: Portfolio;
  aging: AgeBucket[];
  period: PeriodResult;
  monthly: MonthlyPoint[];
  bySalesperson: SalespersonRow[];
  byCostCategory: CostCategoryRow[];
};

/** Estados que siguen ocupando lugar en el patio. */
const IN_STOCK = sql`('INGRESADO','EN_PREPARACION','PUBLICADO','RESERVADO','PAUSADO')`;

export async function getDashboard(
  ctx: TenantCtx,
  range: { from: Date; to: Date },
  baseCurrency: string,
): Promise<Result<Dashboard>> {
  if (!canSeeFinancials(ctx.role)) {
    return fail('FORBIDDEN', 'Esta sección es solo para dueños y administradores.');
  }

  const { from, to } = range;

  // Las fechas viajan como texto con cast explícito: postgres.js no sabe
  // bindear un Date de JavaScript dentro de un fragmento crudo.
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const data = await withTenant(ctx, async (tx) => {
    const [portfolioRow] = await tx.execute<Record<string, unknown>>(sql`
      select
        count(*) filter (where v.ownership = 'OWNED')::int        as owned_count,
        count(*) filter (where v.ownership = 'CONSIGNMENT')::int  as consignment_count,
        coalesce(sum(f.acquisition_base_cents) filter (where v.ownership = 'OWNED'), 0) as capital_tied,
        coalesce(sum(f.costs_base_cents), 0)                      as costs_in_stock,
        coalesce(round(avg(now()::date - v.acquired_at::date)), 0)::int as avg_days,
        coalesce(max(now()::date - v.acquired_at::date), 0)::int  as oldest_days
      from vehicles v
      left join vehicle_financials f on f.vehicle_id = v.id
      where v.status in ${IN_STOCK}
    `);

    const agingRows = await tx.execute<Record<string, unknown>>(sql`
      with tramos as (
        select
          case
            when now()::date - v.acquired_at::date <= 30 then 0
            when now()::date - v.acquired_at::date <= 60 then 1
            when now()::date - v.acquired_at::date <= 90 then 2
            else 3
          end as bucket,
          v.ownership,
          coalesce(f.acquisition_base_cents, 0) as capital
        from vehicles v
        left join vehicle_financials f on f.vehicle_id = v.id
        where v.status in ${IN_STOCK}
      )
      select
        bucket,
        count(*)::int as units,
        coalesce(sum(capital) filter (where ownership = 'OWNED'), 0) as capital
      from tramos
      group by bucket
      order by bucket
    `);

    const [periodRow] = await tx.execute<Record<string, unknown>>(sql`
      select
        count(*)::int                                             as units,
        coalesce(sum(f.sale_base_cents), 0)                       as revenue,
        coalesce(sum(f.gross_margin_base_cents), 0)               as margin,
        coalesce(round(avg(f.days_in_stock)), 0)::int             as avg_days,
        count(*) filter (where v.ownership = 'OWNED')::int         as owned_units,
        coalesce(sum(f.gross_margin_base_cents) filter (where v.ownership = 'OWNED'), 0) as owned_margin,
        count(*) filter (where v.ownership = 'CONSIGNMENT')::int   as consignment_units,
        coalesce(sum(f.gross_margin_base_cents) filter (where v.ownership = 'CONSIGNMENT'), 0) as consignment_margin
      from vehicles v
      join vehicle_financials f on f.vehicle_id = v.id
      where v.status = 'VENDIDO'
        and v.sold_at >= ${fromIso}::timestamptz
        and v.sold_at < ${toIso}::timestamptz
    `);

    const monthlyRows = await tx.execute<Record<string, unknown>>(sql`
      select
        to_char(date_trunc('month', v.sold_at), 'YYYY-MM')  as month,
        count(*)::int                                        as units,
        coalesce(sum(f.sale_base_cents), 0)                  as revenue,
        coalesce(sum(f.gross_margin_base_cents), 0)          as margin
      from vehicles v
      join vehicle_financials f on f.vehicle_id = v.id
      where v.status = 'VENDIDO'
        and v.sold_at >= date_trunc('month', ${toIso}::timestamptz) - interval '11 months'
        and v.sold_at < date_trunc('month', ${toIso}::timestamptz) + interval '1 month'
      group by 1
      order by 1
    `);

    const salesRows = await tx.execute<Record<string, unknown>>(sql`
      select
        s.salesperson_user_id                         as user_id,
        coalesce(u.name, u.email, 'Sin asignar')      as name,
        count(*)::int                                 as units,
        coalesce(sum(f.sale_base_cents), 0)           as revenue,
        coalesce(sum(f.gross_margin_base_cents), 0)   as margin
      from vehicle_sales s
      join vehicle_financials f on f.vehicle_id = s.vehicle_id
      left join users u on u.id = s.salesperson_user_id
      where s.sold_at >= ${fromIso}::timestamptz and s.sold_at < ${toIso}::timestamptz
      group by 1, 2
      order by margin desc
    `);

    const costRows = await tx.execute<Record<string, unknown>>(sql`
      select
        c.category::text                              as category,
        coalesce(sum(c.value_amount_base_cents), 0)   as amount,
        count(*)::int                                 as entries
      from vehicle_costs c
      where c.occurred_at >= ${fromIso}::timestamptz and c.occurred_at < ${toIso}::timestamptz
      group by 1
      order by amount desc
    `);

    return { portfolioRow, agingRows, periodRow, monthlyRows, salesRows, costRows };
  });

  const revenue = big(data.periodRow?.revenue);
  const margin = big(data.periodRow?.margin);

  return ok({
    from,
    to,
    baseCurrency,
    portfolio: {
      ownedCount: num(data.portfolioRow?.owned_count),
      consignmentCount: num(data.portfolioRow?.consignment_count),
      capitalTiedBaseCents: big(data.portfolioRow?.capital_tied),
      costsInStockBaseCents: big(data.portfolioRow?.costs_in_stock),
      avgDaysInStock: num(data.portfolioRow?.avg_days),
      oldestDays: num(data.portfolioRow?.oldest_days),
    },
    aging: buildAging(data.agingRows),
    period: {
      unitsSold: num(data.periodRow?.units),
      revenueBaseCents: revenue,
      marginBaseCents: margin,
      // Margen sobre facturación: es la pregunta que se hace un dueño
      // ("de cada 100 que entraron, cuántos me quedaron").
      marginPct: revenue === 0n ? null : Number((margin * 10_000n) / revenue) / 100,
      avgDaysToSell: num(data.periodRow?.avg_days),
      owned: {
        units: num(data.periodRow?.owned_units),
        marginBaseCents: big(data.periodRow?.owned_margin),
      },
      consignment: {
        units: num(data.periodRow?.consignment_units),
        marginBaseCents: big(data.periodRow?.consignment_margin),
      },
    },
    monthly: fillMonths(data.monthlyRows, to),
    bySalesperson: data.salesRows.map((r) => ({
      userId: (r.user_id as string | null) ?? null,
      name: String(r.name),
      unitsSold: num(r.units),
      revenueBaseCents: big(r.revenue),
      marginBaseCents: big(r.margin),
    })),
    byCostCategory: data.costRows.map((r) => ({
      category: String(r.category),
      amountBaseCents: big(r.amount),
      entries: num(r.entries),
    })),
  });
}

const BUCKETS: { label: string; from: number; to: number | null }[] = [
  { label: 'Hasta 30 días', from: 0, to: 30 },
  { label: '31 a 60', from: 31, to: 60 },
  { label: '61 a 90', from: 61, to: 90 },
  { label: 'Más de 90', from: 91, to: null },
];

function buildAging(rows: Record<string, unknown>[]): AgeBucket[] {
  const byIndex = new Map(rows.map((r) => [num(r.bucket), r]));

  // Los tramos vacíos se muestran igual: un tramo que desaparece de la
  // pantalla se lee como "no hay problema ahí", y no es lo mismo que cero.
  return BUCKETS.map((bucket, i) => {
    const row = byIndex.get(i);
    return {
      ...bucket,
      units: num(row?.units),
      capitalBaseCents: big(row?.capital),
    };
  });
}

function fillMonths(rows: Record<string, unknown>[], to: Date): MonthlyPoint[] {
  const byMonth = new Map(rows.map((r) => [String(r.month), r]));
  const out: MonthlyPoint[] = [];

  const cursor = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  cursor.setUTCMonth(cursor.getUTCMonth() - 11);

  for (let i = 0; i < 12; i++) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    const row = byMonth.get(key);
    out.push({
      month: key,
      unitsSold: num(row?.units),
      revenueBaseCents: big(row?.revenue),
      marginBaseCents: big(row?.margin),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return out;
}
