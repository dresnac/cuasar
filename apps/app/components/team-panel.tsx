'use client';

import { useActionState, useState, useTransition } from 'react';
import type { MemberRow, SeatState } from '@cuasar/core/services';
import type { Role } from '@cuasar/core';
import {
  changeRoleAction,
  changeSeatsAction,
  inviteMemberAction,
  removeMemberAction,
  type ActionState,
} from '@/app/(dash)/cuenta/actions';
import { Alert, Button, Field, Input, Select, cx } from './ui';
import { money } from '@/lib/format';

const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Dueño',
  ADMIN: 'Administrador',
  SALES: 'Ventas',
  VIEWER: 'Solo lectura',
};

const ROLE_HINT: Record<Role, string> = {
  OWNER: 'Todo, incluida la facturación',
  ADMIN: 'Todo menos dar de baja la agencia',
  SALES: 'Vehículos, consultas y agenda. No ve costos ni márgenes',
  VIEWER: 'Solo mira',
};

export function TeamPanel({
  members,
  seats,
  editable,
}: {
  members: MemberRow[];
  seats: SeatState;
  editable: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [inviteState, inviteAction, inviting] = useActionState<ActionState, FormData>(
    inviteMemberAction,
    {},
  );
  const [seatState, seatAction, savingSeats] = useActionState<ActionState, FormData>(
    changeSeatsAction,
    {},
  );

  const run = (fn: () => Promise<ActionState>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result?.error) setError(result.error);
    });

  const full = seats.available <= 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg bg-paper p-3">
        <p className="text-[13px]">
          <strong className="font-semibold">
            {seats.used} de {seats.limit}
          </strong>{' '}
          asientos en uso.{' '}
          {seats.limit > seats.includedSeats ? (
            <span className="text-ink-soft">
              {seats.includedSeats} incluidos y {seats.limit - seats.includedSeats} adicionales.
            </span>
          ) : (
            <span className="text-ink-soft">El plan incluye {seats.includedSeats}.</span>
          )}
        </p>

        <form action={seatAction} className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="Asientos" hint={`${money(seats.extraSeatPriceCents, seats.currency)} c/u extra`}>
            <Input
              name="seats"
              type="number"
              min={Math.max(seats.includedSeats, seats.used)}
              max={50}
              defaultValue={seats.limit}
              disabled={!editable}
              className="w-24"
            />
          </Field>
          <Button type="submit" size="sm" variant="secondary" disabled={!editable || savingSeats}>
            {savingSeats ? 'Guardando…' : 'Cambiar'}
          </Button>
        </form>

        {seatState.error && (
          <div className="mt-2">
            <Alert tone="stale">{seatState.error}</Alert>
          </div>
        )}
        {seatState.ok && <p className="mt-2 text-[12px] text-fresh">{seatState.message}</p>}
      </div>

      <ul className={cx('divide-y divide-line', pending && 'opacity-60')}>
        {members.map((member) => (
          <li key={member.membershipId} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {member.name ?? member.email}
                {member.isMe && <span className="ml-1.5 text-[11px] text-ink-faint">(vos)</span>}
                {member.status === 'INVITED' && (
                  <span className="ml-2 rounded-full border border-warm/30 bg-warm-soft px-1.5 py-0.5 text-[10px] font-medium text-warm">
                    invitado
                  </span>
                )}
              </p>
              <p className="text-[12px] text-ink-faint">{member.email}</p>
            </div>

            <Select
              value={member.role}
              disabled={!editable || member.isMe}
              title={ROLE_HINT[member.role]}
              onChange={(e) =>
                run(() => changeRoleAction(member.membershipId, e.target.value as Role))
              }
              className="h-8 w-40 text-[12px]"
            >
              {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>

            {!member.isMe && (
              <button
                type="button"
                disabled={!editable}
                onClick={() => run(() => removeMemberAction(member.membershipId))}
                className="rounded px-2 py-1 text-[12px] text-ink-faint hover:text-stale disabled:opacity-45"
              >
                Sacar
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && <Alert tone="stale">{error}</Alert>}

      <form action={inviteAction} className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
        <Field label="Invitar por mail" className="min-w-56 flex-1">
          <Input
            name="email"
            type="email"
            required
            placeholder="vendedor@agencia.com"
            disabled={!editable || full}
          />
        </Field>
        <Field label="Rol">
          <Select name="role" defaultValue="SALES" disabled={!editable || full}>
            <option value="ADMIN">Administrador</option>
            <option value="SALES">Ventas</option>
            <option value="VIEWER">Solo lectura</option>
          </Select>
        </Field>
        <Button type="submit" disabled={!editable || full || inviting}>
          {inviting ? 'Invitando…' : 'Invitar'}
        </Button>

        {full && (
          <p className="w-full text-[12px] text-warm">
            No quedan asientos libres. Sumá uno arriba o sacá a alguien del equipo.
          </p>
        )}
        {inviteState.error && (
          <div className="w-full">
            <Alert tone="stale">{inviteState.error}</Alert>
          </div>
        )}
        {inviteState.ok && (
          <p className="w-full text-[12px] text-fresh">{inviteState.message}</p>
        )}
      </form>
    </div>
  );
}
