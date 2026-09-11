'use server';

import { revalidatePath } from 'next/cache';
import {
  createAppointment,
  rescheduleAppointment,
  setAppointmentStatus,
  setAvailability,
  suggestSlots,
  type AppointmentStatus,
} from '@cuasar/core/services';
import { requireSession } from '@/lib/tenant';

export type ActionState = { error?: string; ok?: true };

export async function createAppointmentAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const date = String(fd.get('date') ?? '');
  const time = String(fd.get('time') ?? '');
  if (!date || !time) return { error: 'Elegí día y hora.' };

  const result = await createAppointment(session.ctx, {
    type: fd.get('type') || 'VISIT',
    // La hora se interpreta en el huso de la agencia, no en el del navegador
    // de quien carga: alguien agendando de viaje no debería mover el turno.
    startsAt: zonedToUtc(date, time, session.agency.timezone),
    durationMinutes: fd.get('duration') || 60,
    assignedTo: str(fd, 'assignedTo'),
    vehicleId: str(fd, 'vehicleId'),
    leadId: str(fd, 'leadId'),
    notes: str(fd, 'notes'),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/agenda');
  revalidatePath('/leads');
  return { ok: true };
}

export async function setAppointmentStatusAction(
  appointmentId: string,
  status: AppointmentStatus,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await setAppointmentStatus(session.ctx, appointmentId, status);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/agenda');
  return {};
}

export async function rescheduleAction(
  appointmentId: string,
  date: string,
  time: string,
  durationMinutes: number,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await rescheduleAppointment(
    session.ctx,
    appointmentId,
    zonedToUtc(date, time, session.agency.timezone),
    durationMinutes,
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/agenda');
  return {};
}

export async function suggestSlotsAction(date: string, assignedTo?: string) {
  const session = await requireSession();
  const slots = await suggestSlots(session.ctx, {
    date,
    timezone: session.agency.timezone,
    assignedTo,
  });
  return slots.map((s) => s.startsAt.toISOString());
}

export async function setAvailabilityAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const slots = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    if (!fd.get(`open-${weekday}`)) continue;
    const fromTime = String(fd.get(`from-${weekday}`) ?? '');
    const toTime = String(fd.get(`to-${weekday}`) ?? '');
    if (fromTime && toTime) slots.push({ weekday, fromTime, toTime });
  }

  const result = await setAvailability(session.ctx, slots);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/agenda');
  return { ok: true };
}

const str = (fd: FormData, key: string) => {
  const value = String(fd.get(key) ?? '').trim();
  return value === '' ? null : value;
};

/**
 * "2026-09-15" + "14:30" en el huso de la agencia → instante UTC.
 *
 * El truco es preguntarle al runtime qué hora local corresponde a un instante
 * tentativo y corregir por la diferencia. Evita traer una librería de husos
 * para la única conversión que hace la aplicación.
 */
function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  const guess = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const asLocal = new Date(guess);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(asLocal);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const rendered = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );

  return new Date(guess + (guess - rendered));
}
