'use client';

import { useState, useTransition } from 'react';
import type { AgencyRow } from '@cuasar/core/services';
import { setAgencyStatusAction } from '@/app/plataforma/actions';
import { cx } from './ui';
import { dateLong } from '@/lib/format';

const AGENCY_STATUS: Record<string, string> = {
  ACTIVE: 'text-[#7ee0a8]',
  SUSPENDED: 'text-[#f0c069]',
  CANCELLED: 'text-paper/40',
};

const SUB_STATUS: Record<string, string> = {
  ACTIVE: 'Al día',
  TRIALING: 'En prueba',
  PAST_DUE: 'Pago pendiente',
  CANCELLED: 'Cancelada',
};

export function AgencyAdminTable({
  agencies,
  canAdminister,
}: {
  agencies: AgencyRow[];
  canAdminister: boolean;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const change = (agency: AgencyRow, status: 'ACTIVE' | 'SUSPENDED') => {
    const verb = status === 'SUSPENDED' ? 'suspender' : 'reactivar';
    const reason = window.prompt(
      `Motivo para ${verb} "${agency.name}". Queda en la auditoría con tu nombre.`,
    );
    if (!reason) return;

    setBusyId(agency.id);
    startTransition(async () => {
      setError(null);
      const result = await setAgencyStatusAction(agency.id, status, reason);
      if (result?.error) setError(result.error);
      setBusyId(null);
    });
  };

  return (
    <div className="overflow-x-auto">
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-[#4a1f18] px-3 py-2 text-[13px] text-[#ffb4a3]">
          {error}
        </p>
      )}

      <table className="w-full min-w-[860px] text-[13px]">
        <thead>
          <tr className="border-b border-paper/15 text-left text-[11px] uppercase tracking-[0.12em] text-paper/45">
            <th scope="col" className="pb-2 font-medium">Agencia</th>
            <th scope="col" className="pb-2 font-medium">Estado</th>
            <th scope="col" className="pb-2 font-medium">Suscripción</th>
            <th scope="col" className="pb-2 text-right font-medium">Usuarios</th>
            <th scope="col" className="pb-2 text-right font-medium">Unidades</th>
            <th scope="col" className="pb-2 font-medium">Alta</th>
            <th scope="col" className="pb-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-paper/10">
          {agencies.map((agency) => (
            <tr key={agency.id} className={cx(busyId === agency.id && 'opacity-50')}>
              <td className="py-2.5">
                <p className="font-medium">{agency.name}</p>
                <p className="text-[11px] text-paper/45">
                  {agency.slug}.cuasar.app · base {agency.baseCurrency}
                </p>
              </td>
              <td className={cx('py-2.5 font-medium', AGENCY_STATUS[agency.status])}>
                {agency.status === 'ACTIVE'
                  ? 'Activa'
                  : agency.status === 'SUSPENDED'
                    ? 'Suspendida'
                    : 'Dada de baja'}
              </td>
              <td className="py-2.5 text-paper/70">
                {agency.subscriptionStatus
                  ? SUB_STATUS[agency.subscriptionStatus] ?? agency.subscriptionStatus
                  : 'sin suscripción'}
                {agency.provider && (
                  <span className="ml-1.5 text-[11px] text-paper/40">
                    {agency.provider === 'STRIPE' ? 'Stripe' : 'MercadoPago'}
                  </span>
                )}
              </td>
              <td className="tabular py-2.5 text-right text-paper/70">
                {agency.members}
                {agency.seatsPurchased && (
                  <span className="text-paper/40">/{agency.seatsPurchased}</span>
                )}
              </td>
              <td className="tabular py-2.5 text-right text-paper/70">{agency.vehicles}</td>
              <td className="tabular py-2.5 text-paper/50">{dateLong(agency.createdAt)}</td>
              <td className="py-2.5 text-right">
                {canAdminister && agency.status !== 'CANCELLED' && (
                  <button
                    type="button"
                    onClick={() =>
                      change(agency, agency.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')
                    }
                    className="rounded-lg border border-paper/25 px-2.5 py-1 text-[12px] font-medium hover:border-paper/60"
                  >
                    {agency.status === 'ACTIVE' ? 'Suspender' : 'Reactivar'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlatformStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-card border border-paper/12 bg-paper/[0.03] p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-paper/45">{label}</p>
      <p className="tabular mt-1.5 font-display text-[26px] font-semibold leading-none tracking-tight">
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[12px] leading-snug text-paper/50">{hint}</p>}
    </div>
  );
}
