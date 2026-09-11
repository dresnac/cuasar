'use client';

import { useActionState, useState, useTransition } from 'react';
import type { CostRow } from '@cuasar/core/services';
import { registerCostAction, removeCostAction, type FormState } from '@/app/(dash)/vehiculos/actions';
import { COST_CATEGORIES, COST_LABEL } from './cost-category';
import { Alert, Button, Field, Input, Select, cx } from './ui';
import { dateLong, money } from '@/lib/format';

export function CostsCard({
  vehicleId,
  costs,
  baseCurrency,
  editable,
}: {
  vehicleId: string;
  costs: CostRow[];
  baseCurrency: string;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, action, submitting] = useActionState<FormState, FormData>(
    registerCostAction.bind(null, vehicleId),
    {},
  );

  const total = costs.reduce((acc, c) => acc + c.amountBaseCents, 0n);

  return (
    <div className="flex flex-col gap-3">
      {costs.length === 0 ? (
        <p className="text-[13px] text-ink-soft">
          Todavía no hay gastos cargados en esta unidad.
        </p>
      ) : (
        <>
          <ul className={cx('divide-y divide-line', pending && 'opacity-60')}>
            {costs.map((cost) => (
              <li key={cost.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-tight">
                    {cost.description || COST_LABEL[cost.category] || cost.category}
                  </p>
                  <p className="tabular mt-0.5 text-[11px] text-ink-faint">
                    {COST_LABEL[cost.category]} · {dateLong(cost.occurredAt)}
                    {cost.supplier && ` · ${cost.supplier}`}
                  </p>
                </div>

                <div className="text-right">
                  <p className="tabular text-[13px] font-medium">
                    {money(cost.amountBaseCents, baseCurrency)}
                  </p>
                  {cost.currency !== baseCurrency && (
                    <p className="tabular text-[11px] text-ink-faint">
                      {money(cost.amountCents, cost.currency)}
                    </p>
                  )}
                </div>

                {editable && (
                  <button
                    type="button"
                    aria-label={`Quitar ${cost.description || COST_LABEL[cost.category]}`}
                    onClick={() =>
                      startTransition(() => void removeCostAction(vehicleId, cost.id))
                    }
                    className="rounded px-1.5 py-1 text-[12px] text-ink-faint hover:bg-stale-soft hover:text-stale"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="flex items-baseline justify-between border-t border-line pt-2">
            <span className="text-[12px] uppercase tracking-[0.1em] text-ink-faint">
              Total invertido en preparación
            </span>
            <span className="tabular font-display text-[15px] font-semibold">
              {money(total, baseCurrency)}
            </span>
          </div>
        </>
      )}

      {editable &&
        (open ? (
          <form action={action} className="flex flex-col gap-3 rounded-lg bg-paper p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Rubro" required>
                <Select name="category" defaultValue="MECHANICAL" required>
                  {COST_CATEGORIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Detalle" hint="lo que se hizo">
                <Input name="description" placeholder="Cambio de embrague" />
              </Field>
              <Field label="Monto" required>
                <Input name="costAmount" required inputMode="decimal" placeholder="85000" />
              </Field>
              <Field label="Moneda">
                <Select name="currency" defaultValue={baseCurrency}>
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                </Select>
              </Field>
              <Field
                label="Cotización"
                hint={`solo si no es ${baseCurrency}`}
              >
                <Input name="fxRate" inputMode="decimal" placeholder="1450.50" />
              </Field>
              <Field label="Fecha">
                <Input
                  name="occurredAt"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </Field>
              <Field label="Proveedor">
                <Input name="supplier" placeholder="Taller Rivas" />
              </Field>
              <Field label="Comprobante">
                <Input name="invoiceRef" placeholder="FC A 0001-00012345" />
              </Field>
            </div>

            {state.error && <Alert tone="stale">{state.error}</Alert>}

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? 'Guardando…' : 'Registrar gasto'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => setOpen(true)}
          >
            Registrar gasto
          </Button>
        ))}
    </div>
  );
}
