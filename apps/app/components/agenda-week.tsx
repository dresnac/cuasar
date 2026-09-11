'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { AppointmentRow, AppointmentStatus } from '@cuasar/core/services';
import { setAppointmentStatusAction } from '@/app/(dash)/agenda/actions';
import { Alert, cx } from './ui';

const TYPE_LABEL: Record<string, string> = {
  VISIT: 'Visita',
  TEST_DRIVE: 'Prueba de manejo',
  DELIVERY: 'Entrega',
  APPRAISAL: 'Tasación',
};

const STATUS_META: Record<AppointmentStatus, { label: string; border: string; dot: string }> = {
  SCHEDULED: { label: 'Agendado', border: 'border-l-signal', dot: 'bg-signal' },
  CONFIRMED: { label: 'Confirmado', border: 'border-l-fresh', dot: 'bg-fresh' },
  DONE: { label: 'Hecho', border: 'border-l-line-strong', dot: 'bg-ink-faint' },
  NO_SHOW: { label: 'No vino', border: 'border-l-stale', dot: 'bg-stale' },
  CANCELLED: { label: 'Cancelado', border: 'border-l-line', dot: 'bg-ink-faint' },
};

export function AgendaWeek({
  days,
  timezone,
  editable,
}: {
  days: { key: string; label: string; weekday: string; isToday: boolean; items: AppointmentRow[] }[];
  timezone: string;
  editable: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const time = (d: Date) =>
    new Intl.DateTimeFormat('es-AR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);

  const act = (id: string, status: AppointmentStatus) =>
    startTransition(async () => {
      setError(null);
      const result = await setAppointmentStatusAction(id, status);
      if (result?.error) setError(result.error);
    });

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="stale">{error}</Alert>}

      <div
        className={cx(
          'grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7',
          pending && 'opacity-60',
        )}
      >
        {days.map((day) => (
          <section
            key={day.key}
            className={cx(
              'rounded-card border bg-surface p-2.5',
              day.isToday ? 'border-ink' : 'border-line',
            )}
          >
            <header className="mb-2 flex items-baseline justify-between px-0.5">
              <span
                className={cx(
                  'text-[12px] font-medium uppercase tracking-[0.1em]',
                  day.isToday ? 'text-ink' : 'text-ink-faint',
                )}
              >
                {day.weekday}
              </span>
              <span className="tabular text-[12px] text-ink-faint">{day.label}</span>
            </header>

            {day.items.length === 0 ? (
              <p className="px-0.5 py-3 text-[12px] text-ink-faint">Libre</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {day.items.map((item) => {
                  const meta = STATUS_META[item.status];
                  return (
                    <li
                      key={item.id}
                      className={cx('rounded-md border-l-2 bg-paper p-2', meta.border)}
                    >
                      <p className="tabular text-[12px] font-semibold">
                        {time(item.startsAt)}–{time(item.endsAt)}
                      </p>
                      <p className="mt-0.5 text-[12px] font-medium leading-tight">
                        {item.leadName ?? TYPE_LABEL[item.type] ?? item.type}
                      </p>

                      {item.leadName && (
                        <p className="text-[11px] text-ink-faint">{TYPE_LABEL[item.type]}</p>
                      )}

                      {item.vehicleLabel && (
                        <Link
                          href={`/vehiculos/${item.vehicleId}`}
                          className="mt-1 block truncate text-[11px] text-ink-soft underline decoration-line-strong underline-offset-2"
                        >
                          {item.vehicleLabel}
                        </Link>
                      )}

                      {item.leadPhone && (
                        <a
                          href={`tel:${item.leadPhone.replace(/\s/g, '')}`}
                          className="tabular mt-0.5 block text-[11px] text-ink-soft"
                        >
                          {item.leadPhone}
                        </a>
                      )}

                      <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-faint">
                        <span className={cx('size-1.5 rounded-full', meta.dot)} aria-hidden />
                        {meta.label}
                        {item.assigneeName && ` · ${item.assigneeName.split(' ')[0]}`}
                      </p>

                      {editable && (item.status === 'SCHEDULED' || item.status === 'CONFIRMED') && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {item.status === 'SCHEDULED' && (
                            <Action onClick={() => act(item.id, 'CONFIRMED')}>Confirmar</Action>
                          )}
                          <Action onClick={() => act(item.id, 'DONE')}>Vino</Action>
                          <Action onClick={() => act(item.id, 'NO_SHOW')}>No vino</Action>
                          <Action onClick={() => act(item.id, 'CANCELLED')}>Cancelar</Action>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function Action({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-line-strong bg-surface px-1.5 py-0.5 text-[10px] font-medium hover:border-ink/40"
    >
      {children}
    </button>
  );
}
