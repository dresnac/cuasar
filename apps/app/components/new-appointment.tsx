'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import {
  createAppointmentAction,
  suggestSlotsAction,
  type ActionState,
} from '@/app/(dash)/agenda/actions';
import { Alert, Button, Card, Field, Input, Select, SectionTitle, Textarea } from './ui';

export function NewAppointment({
  team,
  vehicles,
  timezone,
  defaultLeadId,
  defaultVehicleId,
  currentUserId,
  editable,
}: {
  team: { id: string; name: string }[];
  vehicles: { id: string; label: string }[];
  timezone: string;
  defaultLeadId?: string;
  defaultVehicleId?: string;
  currentUserId: string;
  editable: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultLeadId));
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [assignedTo, setAssignedTo] = useState(currentUserId);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loadingSlots, startLoading] = useTransition();

  const [state, action, pending] = useActionState<ActionState, FormData>(
    createAppointmentAction,
    {},
  );

  // Los horarios libres los calcula el servidor: dependen del horario de
  // atención de la agencia y de lo que ya tiene esa persona, no del reloj
  // del navegador.
  useEffect(() => {
    if (!open) return;
    startLoading(async () => {
      setSlots(await suggestSlotsAction(date, assignedTo));
    });
  }, [open, date, assignedTo]);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  if (!open) {
    return (
      <Button type="button" disabled={!editable} onClick={() => setOpen(true)}>
        Agendar turno
      </Button>
    );
  }

  const timeOf = (iso: string) =>
    new Intl.DateTimeFormat('es-AR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));

  return (
    <Card className="p-4">
      <SectionTitle eyebrow="Nuevo">Agendar turno</SectionTitle>

      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="leadId" value={defaultLeadId ?? ''} />

        <Field label="Tipo">
          <Select name="type" defaultValue="VISIT">
            <option value="VISIT">Visita</option>
            <option value="TEST_DRIVE">Prueba de manejo</option>
            <option value="DELIVERY">Entrega</option>
            <option value="APPRAISAL">Tasación</option>
          </Select>
        </Field>

        <Field label="Atiende">
          <Select
            name="assignedTo"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
          >
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Día" required>
          <Input
            name="date"
            type="date"
            required
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        <Field
          label="Hora"
          hint={loadingSlots ? 'buscando…' : slots?.length ? `${slots.length} libres` : undefined}
          required
        >
          {slots && slots.length === 0 ? (
            <p className="rounded-lg border border-warm/30 bg-warm-soft px-3 py-2 text-[12px] text-warm">
              Ese día no queda ningún horario libre. Probá con otro, o revisá el horario de
              atención más abajo.
            </p>
          ) : (
            <Select name="time" required disabled={!slots}>
              {(slots ?? []).map((iso) => (
                <option key={iso} value={timeOf(iso)}>
                  {timeOf(iso)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Duración">
          <Select name="duration" defaultValue="60">
            <option value="30">30 minutos</option>
            <option value="60">1 hora</option>
            <option value="90">1 hora y media</option>
            <option value="120">2 horas</option>
          </Select>
        </Field>

        <Field label="Vehículo" hint="opcional">
          <Select name="vehicleId" defaultValue={defaultVehicleId ?? ''}>
            <option value="">Ninguno en particular</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Notas" className="sm:col-span-2">
          <Textarea name="notes" rows={2} placeholder="Viene con la permuta para tasarla" />
        </Field>

        {state.error && (
          <div className="sm:col-span-2">
            <Alert tone="stale">{state.error}</Alert>
          </div>
        )}

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending || !slots?.length}>
            {pending ? 'Agendando…' : 'Agendar'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
