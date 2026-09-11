import type { CostCategoryRow } from '@cuasar/core/services';
import { COST_LABEL } from './cost-category';
import { money } from '@/lib/format';

/** En qué se fue la plata de preparación, ordenado por peso. */
export function CostBreakdown({
  rows,
  baseCurrency,
}: {
  rows: CostCategoryRow[];
  baseCurrency: string;
}) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-ink-soft">No hay gastos registrados en el período.</p>;
  }

  const max = rows.reduce((acc, r) => (r.amountBaseCents > acc ? r.amountBaseCents : acc), 1n);

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.category}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-[13px]">{COST_LABEL[row.category] ?? row.category}</span>
            <span className="tabular text-[13px] font-medium">
              {money(row.amountBaseCents, baseCurrency)}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-paper">
            <div
              className="h-full rounded-full bg-ink-soft"
              style={{ width: `${Number((row.amountBaseCents * 100n) / max)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
