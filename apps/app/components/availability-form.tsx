'use client';

import { useActionState } from 'react';
import { setAvailabilityAction, type ActionState } from '@/app/(dash)/agenda/actions';
import { Alert, Button, cx } from './ui';

const DAYS = [
  [1, 'Lunes'],
  [2, 'Martes'],
  [3, 'Miércoles'],
  [4, 'Jueves'],
  [5, 'Viernes'],
  [6, 'Sábado'],
  [0, 'Domingo'],
] as const;

export type AvailabilityRow = { weekday: number; fromTime: string; toTime: string };

/**
 * El horario de atención. De acá salen los huecos que se ofrecen al agendar,
 * así que un día sin horario es un día en el que no se puede dar un turno.
 */
export function AvailabilityForm({
  current,
  editable,
}: {
  current: AvailabilityRow[];
  editable: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    setAvailabilityAction,
    {},
  );

  const byDay = new Map(current.map((r) => [r.weekday, r]));

  return (
    <form action={action} className={cx('flex flex-col gap-2', pending && 'opacity-60')}>
      {DAYS.map(([weekday, label]) => {
        const row = byDay.get(weekday);
        return (
          <div key={weekday} className="flex items-center gap-3">
            <label className="flex w-32 items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                name={`open-${weekday}`}
                defaultChecked={Boolean(row)}
                disabled={!editable}
                className="size-4 accent-[var(--color-ink)]"
              />
              {label}
            </label>

            <input
              type="time"
              name={`from-${weekday}`}
              defaultValue={(row?.fromTime ?? '09:00:00').slice(0, 5)}
              disabled={!editable}
              className="tabular h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] focus:border-signal focus:outline-none"
            />
            <span className="text-[12px] text-ink-faint">a</span>
            <input
              type="time"
              name={`to-${weekday}`}
              defaultValue={(row?.toTime ?? '18:00:00').slice(0, 5)}
              disabled={!editable}
              className="tabular h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] focus:border-signal focus:outline-none"
            />
          </div>
        );
      })}

      {state.error && <Alert tone="stale">{state.error}</Alert>}
      {state.ok && <p className="text-[12px] text-fresh">Horario guardado.</p>}

      <Button type="submit" size="sm" variant="secondary" disabled={!editable || pending} className="self-start">
        {pending ? 'Guardando…' : 'Guardar horario'}
      </Button>
    </form>
  );
}
