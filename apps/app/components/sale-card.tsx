'use client';

import { useActionState, useState } from 'react';
import { registerSaleAction, type FormState } from '@/app/(dash)/vehiculos/actions';
import { Alert, Button, Field, Input, Select } from './ui';
import { dateLong, money } from '@/lib/format';

export type SaleSummary = {
  amountCents: bigint;
  currency: string;
  amountBaseCents: bigint;
  buyer: unknown;
  paymentMethod: string | null;
  soldAt: Date;
  salespersonName: string | null;
};

export function SaleCard({
  vehicleId,
  sale,
  sellable,
  editable,
  baseCurrency,
  floorBaseCents,
  team,
}: {
  vehicleId: string;
  sale: SaleSummary | null;
  sellable: boolean;
  editable: boolean;
  baseCurrency: string;
  floorBaseCents: bigint | null;
  team: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, submitting] = useActionState<FormState, FormData>(
    registerSaleAction.bind(null, vehicleId),
    {},
  );

  if (sale) {
    const buyer = (sale.buyer ?? {}) as { name?: string | null; phone?: string | null };

    return (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-4">
        <Item label="Se vendió en" value={money(sale.amountCents, sale.currency)} strong />
        <Item label="Fecha" value={dateLong(sale.soldAt)} />
        <Item label="Comprador" value={buyer.name || '—'} />
        <Item label="Vendedor" value={sale.salespersonName || '—'} />
        {sale.paymentMethod && <Item label="Forma de pago" value={sale.paymentMethod} />}
        {sale.currency !== baseCurrency && (
          <Item label={`Equivale a`} value={money(sale.amountBaseCents, baseCurrency)} />
        )}
      </dl>
    );
  }

  if (!sellable) {
    return (
      <p className="text-[13px] text-ink-soft">
        Para cerrar una venta la unidad tiene que estar publicada o reservada.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-ink-soft">
          Cerrar la venta registra el monto y calcula el resultado de la unidad.
        </p>
        <Button
          type="button"
          className="self-start"
          disabled={!editable}
          onClick={() => setOpen(true)}
        >
          Cerrar venta
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      {floorBaseCents !== null && (
        <p className="text-[12px] text-ink-soft">
          Piso acordado con el dueño: {money(floorBaseCents, baseCurrency)}. Por debajo de ese
          monto la venta no se registra.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Monto de venta" required>
          <Input name="saleAmount" required autoFocus inputMode="decimal" placeholder="23500" />
        </Field>
        <Field label="Moneda">
          <Select name="currency" defaultValue={baseCurrency}>
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </Select>
        </Field>
        <Field label="Cotización" hint={`solo si no es ${baseCurrency}`}>
          <Input name="fxRate" inputMode="decimal" placeholder="1450.50" />
        </Field>
        <Field label="Fecha">
          <Input name="soldAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Comprador">
          <Input name="buyerName" placeholder="Nombre y apellido" />
        </Field>
        <Field label="Teléfono">
          <Input name="buyerPhone" placeholder="+54 9 11 …" />
        </Field>
        <Field label="Forma de pago">
          <Input name="paymentMethod" placeholder="Transferencia" />
        </Field>
        <Field label="Vendedor">
          <Select name="salespersonUserId" defaultValue="">
            <option value="">Quien registra</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {state.error && <Alert tone="stale">{state.error}</Alert>}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Registrando…' : 'Registrar la venta'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function Item({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.1em] text-ink-faint">{label}</dt>
      <dd
        className={`tabular mt-0.5 ${strong ? 'font-display text-[15px] font-semibold' : 'font-medium'}`}
      >
        {value}
      </dd>
    </div>
  );
}
