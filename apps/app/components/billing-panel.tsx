'use client';

import { useState, useTransition } from 'react';
import type { BillingSummary } from '@cuasar/core/services';
import type { BillingProvider } from '@cuasar/core';
import { openPortalAction, startCheckoutAction } from '@/app/(dash)/cuenta/actions';
import { Alert, Button, cx } from './ui';
import { dateLong, money } from '@/lib/format';

const STATUS_META: Record<string, { label: string; tone: string; hint: string }> = {
  TRIALING: {
    label: 'En prueba',
    tone: 'bg-warm-soft text-warm border-warm/30',
    hint: 'Podés usar todo. Conectá un medio de pago antes de que termine.',
  },
  ACTIVE: {
    label: 'Al día',
    tone: 'bg-fresh-soft text-fresh border-fresh/25',
    hint: 'La suscripción está activa.',
  },
  PAST_DUE: {
    label: 'Pago pendiente',
    tone: 'bg-stale-soft text-stale border-stale/25',
    hint: 'Actualizá el medio de pago. Pasado el período de gracia la cuenta queda en solo lectura.',
  },
  CANCELLED: {
    label: 'Cancelada',
    tone: 'bg-paper text-ink-faint border-line',
    hint: 'La cuenta no tiene acceso. Los datos se conservan 90 días.',
  },
};

export function BillingPanel({
  summary,
  providers,
}: {
  summary: BillingSummary;
  providers: BillingProvider[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const meta = STATUS_META[summary.status] ?? STATUS_META.TRIALING!;

  const run = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result?.error) setError(result.error);
    });

  const extraSeats = Math.max(0, summary.seatsPurchased - summary.includedSeats);
  const monthly =
    summary.priceCents + BigInt(extraSeats) * summary.extraSeatPriceCents;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2">
            <span className="font-display text-[17px] font-semibold tracking-tight">
              {summary.planName}
            </span>
            <span className={cx('rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.tone)}>
              {meta.label}
            </span>
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">{meta.hint}</p>
        </div>

        <div className="text-right">
          <p className="tabular font-display text-[22px] font-semibold tracking-tight">
            {money(monthly, summary.currency)}
            <span className="text-[13px] font-normal text-ink-faint"> / mes</span>
          </p>
          {extraSeats > 0 && (
            <p className="tabular text-[12px] text-ink-faint">
              {money(summary.priceCents, summary.currency)} + {extraSeats} asiento
              {extraSeats === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </div>

      {summary.currentPeriodEnd && (
        <p className="tabular text-[13px] text-ink-soft">
          {summary.cancelAtPeriodEnd ? 'La cuenta se cierra el ' : 'Próximo cobro el '}
          {dateLong(summary.currentPeriodEnd)}.
        </p>
      )}

      {error && <Alert tone="stale">{error}</Alert>}

      <div className="flex flex-wrap gap-2">
        {summary.providerCustomerId ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => openPortalAction())}
          >
            Administrar el pago
          </Button>
        ) : providers.length === 0 ? (
          <Alert tone="warm">
            La plataforma todavía no tiene ningún medio de cobro conectado. Mientras tanto la
            cuenta funciona en modo prueba.
          </Alert>
        ) : (
          providers.map((provider) => (
            <Button
              key={provider}
              type="button"
              variant={provider === 'STRIPE' ? 'primary' : 'secondary'}
              disabled={pending}
              onClick={() => run(() => startCheckoutAction(provider))}
            >
              {provider === 'STRIPE' ? 'Pagar con tarjeta' : 'Pagar con MercadoPago'}
            </Button>
          ))
        )}
      </div>

      {summary.invoices.length > 0 && (
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">
            Facturas
          </p>
          <ul className="divide-y divide-line">
            {summary.invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between py-2 text-[13px]">
                <span className="tabular text-ink-soft">{dateLong(invoice.issuedAt)}</span>
                <span className="tabular font-medium">
                  {money(invoice.amountCents, invoice.currency)}
                </span>
                <span className="text-[12px] text-ink-faint">{invoice.status}</span>
                {invoice.pdfUrl ? (
                  <a
                    href={invoice.pdfUrl}
                    className="text-[12px] text-signal underline underline-offset-2"
                  >
                    PDF
                  </a>
                ) : (
                  <span className="text-[12px] text-ink-faint">—</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
