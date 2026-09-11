import {
  and,
  asc,
  eq,
  gte,
  inArray,
  lt,
  ne,
  or,
  schema,
  sql,
  withTenant,
  type TenantCtx,
} from '@cuasar/db';
import { z } from 'zod';
import { fail, ok, type Result } from '../errors';
import { can } from '../permissions';
import { appendEvent } from './_tx';
import { enqueue } from './outbox';

const { appointments, availability, leads, users, vehicles } = schema;

export const APPOINTMENT_TYPES = ['VISIT', 'TEST_DRIVE', 'DELIVERY', 'APPRAISAL'] as const;
export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'DONE',
  'NO_SHOW',
  'CANCELLED',
] as const;

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Los estados que todavía ocupan un lugar en la agenda. */
const ACTIVE_STATUSES = ['SCHEDULED', 'CONFIRMED'] as const;

/**
 * Turnos y visitas.
 *
 * Un vendedor ve su agenda y la que no tiene dueño; un administrador ve la de
 * todos. Misma regla que la bandeja de consultas, por la misma razón: dos
 * personas esperando al mismo cliente es peor que una agenda incompleta.
 */
function visibilityClause(ctx: TenantCtx) {
  if (can(ctx.role, 'member:manage')) return undefined;
  return or(sql`${appointments.assignedTo} is null`, eq(appointments.assignedTo, ctx.userId));
}

export const appointmentInput = z.object({
  type: z.enum(APPOINTMENT_TYPES).default('VISIT'),
  startsAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
  vehicleId: z.string().uuid().nullish(),
  leadId: z.string().uuid().nullish(),
  assignedTo: z.string().uuid().nullish(),
  notes: z.string().max(1000).nullish(),
});

export type AppointmentRow = {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  notes: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
};

export async function listAppointments(
  ctx: TenantCtx,
  range: { from: Date; to: Date },
): Promise<Result<AppointmentRow[]>> {
  if (!can(ctx.role, 'appointment:read')) return fail('FORBIDDEN', 'No podés ver la agenda.');

  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({
        id: appointments.id,
        type: appointments.type,
        status: appointments.status,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        notes: appointments.notes,
        assignedTo: appointments.assignedTo,
        assigneeName: users.name,
        leadId: appointments.leadId,
        leadName: leads.name,
        leadPhone: leads.phone,
        vehicleId: appointments.vehicleId,
        brand: vehicles.brand,
        model: vehicles.model,
        year: vehicles.year,
      })
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.assignedTo))
      .leftJoin(leads, eq(leads.id, appointments.leadId))
      .leftJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
      .where(
        and(
          visibilityClause(ctx),
          gte(appointments.startsAt, range.from),
          lt(appointments.startsAt, range.to),
          ne(appointments.status, 'CANCELLED'),
        ),
      )
      .orderBy(asc(appointments.startsAt)),
  );

  return ok(
    rows.map((r) => ({
      id: r.id,
      type: r.type as AppointmentType,
      status: r.status as AppointmentStatus,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      notes: r.notes,
      assignedTo: r.assignedTo,
      assigneeName: r.assigneeName,
      leadId: r.leadId,
      leadName: r.leadName,
      leadPhone: r.leadPhone,
      vehicleId: r.vehicleId,
      vehicleLabel: r.brand ? `${r.brand} ${r.model} ${r.year}` : null,
    })),
  );
}

export async function createAppointment(
  ctx: TenantCtx,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  if (!can(ctx.role, 'appointment:write')) return fail('FORBIDDEN', 'No podés agendar turnos.');

  const parsed = appointmentInput.safeParse(raw);
  if (!parsed.success) {
    return fail('VALIDATION', 'Revisá los datos del turno.', { issues: parsed.error.issues });
  }
  const input = parsed.data;
  const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
  const assignedTo = input.assignedTo ?? ctx.userId;

  return withTenant(ctx, async (tx) => {
    const clash = await findOverlap(tx, assignedTo, input.startsAt, endsAt, null);
    if (clash) {
      return fail<{ id: string }>(
        'CONFLICT',
        `Esa persona ya tiene un turno de ${formatTime(clash.startsAt)} a ${formatTime(clash.endsAt)}.`,
      );
    }

    const [created] = await tx
      .insert(appointments)
      .values({
        agencyId: ctx.agencyId,
        type: input.type,
        status: 'SCHEDULED',
        startsAt: input.startsAt,
        endsAt,
        vehicleId: input.vehicleId ?? null,
        leadId: input.leadId ?? null,
        assignedTo,
        notes: input.notes ?? null,
      })
      .returning({ id: appointments.id });

    if (input.vehicleId) {
      await appendEvent(tx, ctx, {
        vehicleId: input.vehicleId,
        type: 'APPOINTMENT_SCHEDULED',
        payload: {
          appointmentId: created!.id,
          type: input.type,
          startsAt: input.startsAt.toISOString(),
        },
      });
    }

    await enqueue(tx, ctx.agencyId, 'appointment.scheduled', { appointmentId: created!.id });

    // Una visita agendada es señal de que la consulta avanzó.
    if (input.leadId) {
      await tx
        .update(leads)
        .set({ status: 'QUALIFIED' })
        .where(and(eq(leads.id, input.leadId), eq(leads.status, 'NEW')));
    }

    return ok({ id: created!.id });
  });
}

export async function rescheduleAppointment(
  ctx: TenantCtx,
  appointmentId: string,
  startsAt: Date,
  durationMinutes: number,
): Promise<Result<true>> {
  if (!can(ctx.role, 'appointment:write')) return fail('FORBIDDEN', 'No podés mover turnos.');

  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

  return withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({ assignedTo: appointments.assignedTo })
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), visibilityClause(ctx) ?? sql`true`))
      .limit(1);

    if (!current) return fail<true>('NOT_FOUND', 'El turno no existe o no es tuyo.');

    const clash = await findOverlap(
      tx,
      current.assignedTo ?? ctx.userId,
      startsAt,
      endsAt,
      appointmentId,
    );
    if (clash) {
      return fail<true>(
        'CONFLICT',
        `Se pisa con otro turno de ${formatTime(clash.startsAt)} a ${formatTime(clash.endsAt)}.`,
      );
    }

    await tx
      .update(appointments)
      .set({ startsAt, endsAt, status: 'SCHEDULED' })
      .where(eq(appointments.id, appointmentId));

    return ok(true as const);
  });
}

export async function setAppointmentStatus(
  ctx: TenantCtx,
  appointmentId: string,
  status: AppointmentStatus,
): Promise<Result<true>> {
  if (!can(ctx.role, 'appointment:write')) return fail('FORBIDDEN', 'No podés cambiar turnos.');

  return withTenant(ctx, async (tx) => {
    const [updated] = await tx
      .update(appointments)
      .set({ status })
      .where(and(eq(appointments.id, appointmentId), visibilityClause(ctx) ?? sql`true`))
      .returning({ id: appointments.id });

    if (!updated) return fail<true>('NOT_FOUND', 'El turno no existe o no es tuyo.');
    return ok(true as const);
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * Dos turnos de la misma persona no pueden solaparse.
 *
 * El rango es semiabierto: un turno que termina 15:00 y otro que empieza
 * 15:00 conviven. Sin eso, una agenda de horas seguidas sería imposible.
 */
async function findOverlap(
  tx: Tx,
  assignedTo: string,
  startsAt: Date,
  endsAt: Date,
  excludeId: string | null,
) {
  const [clash] = await tx
    .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.assignedTo, assignedTo),
        inArray(appointments.status, [...ACTIVE_STATUSES]),
        lt(appointments.startsAt, endsAt),
        sql`${appointments.endsAt} > ${startsAt.toISOString()}::timestamptz`,
        excludeId ? ne(appointments.id, excludeId) : undefined,
      ),
    )
    .limit(1);

  return clash ?? null;
}

const formatTime = (d: Date) =>
  new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(d);

// ---------------------------------------------------------------------------
// Disponibilidad
// ---------------------------------------------------------------------------

export const availabilityInput = z.array(
  z.object({
    weekday: z.coerce.number().int().min(0).max(6),
    fromTime: z.string().regex(/^\d{2}:\d{2}$/),
    toTime: z.string().regex(/^\d{2}:\d{2}$/),
  }),
);

export async function getAvailability(ctx: TenantCtx) {
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: availability.id,
        weekday: availability.weekday,
        fromTime: availability.fromTime,
        toTime: availability.toTime,
      })
      .from(availability)
      .where(sql`${availability.userId} is null`)
      .orderBy(asc(availability.weekday), asc(availability.fromTime)),
  );
}

/** Horario de atención de la agencia. Se reemplaza entero, no se parchea. */
export async function setAvailability(ctx: TenantCtx, raw: unknown): Promise<Result<true>> {
  if (!can(ctx.role, 'agency:settings')) {
    return fail('FORBIDDEN', 'Solo un administrador cambia el horario de atención.');
  }

  const parsed = availabilityInput.safeParse(raw);
  if (!parsed.success) return fail('VALIDATION', 'Revisá los horarios.');

  for (const slot of parsed.data) {
    if (slot.fromTime >= slot.toTime) {
      return fail('VALIDATION', 'Hay un horario que termina antes de empezar.');
    }
  }

  return withTenant(ctx, async (tx) => {
    await tx.delete(availability).where(sql`${availability.userId} is null`);

    if (parsed.data.length) {
      await tx.insert(availability).values(
        parsed.data.map((slot) => ({
          agencyId: ctx.agencyId,
          userId: null,
          weekday: slot.weekday,
          fromTime: `${slot.fromTime}:00`,
          toTime: `${slot.toTime}:00`,
        })),
      );
    }

    return ok(true as const);
  });
}

export type Slot = { startsAt: Date; endsAt: Date };

/**
 * Huecos libres de un día.
 *
 * El cálculo va en SQL y no en JavaScript porque las franjas de atención
 * están en hora local de la agencia y los turnos en UTC: hacer la conversión
 * a mano es la forma más rápida de ofrecer un turno a las 3 de la mañana.
 * Postgres ya sabe hacerlo con `at time zone`.
 */
export async function suggestSlots(
  ctx: TenantCtx,
  input: { date: string; timezone: string; durationMinutes?: number; assignedTo?: string },
): Promise<Slot[]> {
  const duration = input.durationMinutes ?? 60;
  const assignee = input.assignedTo ?? ctx.userId;

  return withTenant(ctx, async (tx) => {
    const rows = await tx.execute<{ starts_at: Date; ends_at: Date }>(sql`
      with dia as (
        select ${input.date}::date as d, ${input.timezone}::text as tz
      ),
      franjas as (
        select
          ((select d from dia) + a.from_time) at time zone (select tz from dia) as inicio,
          ((select d from dia) + a.to_time)   at time zone (select tz from dia) as fin
        from availability a
        where a.user_id is null
          and a.weekday = extract(dow from (select d from dia))::int
      ),
      candidatos as (
        select gs as starts_at, gs + make_interval(mins => ${duration}) as ends_at
        from franjas f,
             lateral generate_series(
               f.inicio,
               f.fin - make_interval(mins => ${duration}),
               interval '30 minutes'
             ) gs
      )
      select c.starts_at, c.ends_at
      from candidatos c
      where c.starts_at > now()
        and not exists (
          select 1 from appointments ap
          where ap.assigned_to = ${assignee}
            and ap.status in ('SCHEDULED','CONFIRMED')
            and ap.starts_at < c.ends_at
            and ap.ends_at   > c.starts_at
        )
      order by c.starts_at
    `);

    return rows.map((r) => ({ startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at) }));
  });
}
