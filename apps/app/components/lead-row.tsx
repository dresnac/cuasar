'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { LeadRow, LeadStatus } from '@cuasar/core/services';
import {
  anonymizeLeadAction,
  assignLeadAction,
  setLeadStatusAction,
} from '@/app/(dash)/leads/actions';
import { LEAD_SOURCE_LABEL, LEAD_STATUS_META } from './lead-meta';
import { Alert, cx } from './ui';
import { dateTime, relativeDays } from '@/lib/format';

const NEXT_STATUS: Partial<Record<LeadStatus, { to: LeadStatus; label: string }[]>> = {
  NEW: [
    { to: 'CONTACTED', label: 'Marcar contactado' },
    { to: 'LOST', label: 'Descartar' },
  ],
  CONTACTED: [
    { to: 'QUALIFIED', label: 'Está interesado' },
    { to: 'LOST', label: 'Descartar' },
  ],
  QUALIFIED: [
    { to: 'WON', label: 'Se vendió' },
    { to: 'LOST', label: 'No cerró' },
  ],
};

export function LeadCard({
  lead,
  team,
  canManage,
  currentUserId,
  editable,
}: {
  lead: LeadRow;
  team: { id: string; name: string }[];
  canManage: boolean;
  currentUserId: string;
  editable: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const meta = LEAD_STATUS_META[lead.status] ?? {
    label: lead.status,
    chip: 'bg-paper text-ink-soft border-line-strong',
  };
  const actions = NEXT_STATUS[lead.status] ?? [];

  const run = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result?.error) setError(result.error);
    });

  return (
    <li className={cx('border-b border-line p-4 last:border-0', pending && 'opacity-60')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-[15px] font-semibold tracking-tight">{lead.name}</h3>
            <span
              className={cx(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                meta.chip,
              )}
            >
              {meta.label}
            </span>
          </div>

          <p className="tabular mt-1 text-[13px] text-ink-soft">
            {lead.phone && (
              <a href={`tel:${lead.phone.replace(/\s/g, '')}`} className="hover:text-ink">
                {lead.phone}
              </a>
            )}
            {lead.email && <span className="ml-2 text-ink-faint">{lead.email}</span>}
          </p>
        </div>

        <p className="tabular shrink-0 text-[12px] text-ink-faint">
          {relativeDays(Math.floor((Date.now() - lead.createdAt.getTime()) / 86_400_000))}
          <span className="ml-1.5 text-ink-faint/70">{sourceLabel(lead.source)}</span>
        </p>
      </div>

      {lead.vehicleLabel && (
        <p className="mt-2 text-[13px]">
          <span className="text-ink-faint">Consulta por </span>
          <Link
            href={`/vehiculos/${lead.vehicleId}`}
            className="underline decoration-line-strong underline-offset-2 hover:decoration-ink"
          >
            {lead.vehicleLabel}
          </Link>
        </p>
      )}

      {lead.message && (
        <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-[13px] leading-snug text-ink-soft">
          {lead.message}
        </p>
      )}

      {lead.appointmentAt && (
        <p className="tabular mt-2 text-[12px] text-fresh">
          Visita agendada para {dateTime(lead.appointmentAt)}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={lead.assignedTo ?? ''}
          disabled={!editable || pending}
          onChange={(e) => run(() => assignLeadAction(lead.id, e.target.value || null))}
          className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[12px] focus:border-signal focus:outline-none"
        >
          <option value="">Sin asignar</option>
          {(canManage ? team : team.filter((m) => m.id === currentUserId)).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        {actions.map((action) => (
          <button
            key={action.to}
            type="button"
            disabled={!editable || pending}
            onClick={() => run(() => setLeadStatusAction(lead.id, action.to))}
            className="h-8 rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] font-medium hover:border-ink/40 disabled:opacity-45"
          >
            {action.label}
          </button>
        ))}

        <Link
          href={{
            pathname: '/agenda',
            query: { lead: lead.id, vehiculo: lead.vehicleId ?? undefined },
          }}
          className="h-8 rounded-lg border border-ink bg-ink px-2.5 text-[12px] font-medium leading-8 text-paper"
        >
          Agendar visita
        </Link>

        {canManage && !lead.phone && null}
        {canManage && lead.phone && (
          <button
            type="button"
            disabled={!editable || pending}
            title="Borra nombre, teléfono y mail. El historial queda intacto."
            onClick={() => run(() => anonymizeLeadAction(lead.id))}
            className="ml-auto h-8 rounded-lg px-2 text-[12px] text-ink-faint hover:text-stale"
          >
            Borrar contacto
          </button>
        )}
      </div>

      {error && (
        <div className="mt-2">
          <Alert tone="stale">{error}</Alert>
        </div>
      )}
    </li>
  );
}

const sourceLabel = (source: string) => LEAD_SOURCE_LABEL[source] ?? '';
