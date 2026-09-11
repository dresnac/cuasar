import { and, dbAdmin, eq, inArray, schema } from '@cuasar/db';
import { claimBatch, markDone, markFailed, type OutboxMessage } from '@cuasar/core/services';
import { emailAdapter, type EmailPort } from './email';

/**
 * El worker que drena la cola de salida.
 *
 * Lee el mensaje, busca los datos frescos —nunca los que venían en el
 * payload— y manda. Si falla, el reintento con espera creciente lo maneja el
 * propio outbox.
 *
 * Buscar los datos al momento de enviar no es un detalle: si alguien
 * anonimizó la consulta entre que entró y que salió el mail, el mail no la
 * filtra.
 */
export async function drainOutbox(limit = 20, email: EmailPort = emailAdapter()) {
  const batch = await claimBatch(limit);
  let sent = 0;
  let failed = 0;

  for (const message of batch) {
    try {
      await handle(message, email);
      await markDone(message.id);
      sent++;
    } catch (error) {
      await markFailed(
        message.id,
        message.attempts,
        error instanceof Error ? error.message : String(error),
      );
      failed++;
    }
  }

  return { claimed: batch.length, sent, failed, adapter: email.name };
}

async function handle(message: OutboxMessage, email: EmailPort) {
  switch (message.topic) {
    case 'lead.received':
      return notifyLead(message, email);
    case 'appointment.scheduled':
      return notifyAppointment(message, email);
    default:
      // Un tema desconocido no es un error que valga la pena reintentar seis
      // veces: se marca hecho y queda el registro de que llegó.
      console.warn('[cuasar:outbox] tema sin handler', message.topic);
      return;
  }
}

async function notifyLead(message: OutboxMessage, email: EmailPort) {
  const leadId = String(message.payload.leadId ?? '');
  if (!leadId) return;

  const [lead] = await dbAdmin
    .select({
      name: schema.leads.name,
      phone: schema.leads.phone,
      email: schema.leads.email,
      body: schema.leads.message,
      anonymizedAt: schema.leads.anonymizedAt,
      assignedTo: schema.leads.assignedTo,
      brand: schema.vehicles.brand,
      model: schema.vehicles.model,
      year: schema.vehicles.year,
      agencyName: schema.agencies.name,
    })
    .from(schema.leads)
    .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.leads.vehicleId))
    .innerJoin(schema.agencies, eq(schema.agencies.id, schema.leads.agencyId))
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead || lead.anonymizedAt) return;

  const recipients = await recipientsFor(message.agencyId, lead.assignedTo);
  if (recipients.length === 0) return;

  const vehicle = lead.brand ? `${lead.brand} ${lead.model} ${lead.year}` : null;

  await email.send({
    to: recipients,
    subject: vehicle
      ? `Consulta por el ${vehicle}`
      : `Nueva consulta en ${lead.agencyName}`,
    replyTo: lead.email ?? undefined,
    text: [
      `${lead.name} dejó una consulta en el sitio.`,
      '',
      vehicle ? `Vehículo: ${vehicle}` : 'No preguntó por una unidad en particular.',
      lead.phone ? `Teléfono: ${lead.phone}` : null,
      lead.email ? `Mail: ${lead.email}` : null,
      lead.body ? `\nMensaje:\n${lead.body}` : null,
      '',
      'Entrá a Cuasar para asignarla y responder.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  });
}

async function notifyAppointment(message: OutboxMessage, email: EmailPort) {
  const appointmentId = String(message.payload.appointmentId ?? '');
  if (!appointmentId) return;

  const [appointment] = await dbAdmin
    .select({
      startsAt: schema.appointments.startsAt,
      type: schema.appointments.type,
      notes: schema.appointments.notes,
      assignedTo: schema.appointments.assignedTo,
      leadName: schema.leads.name,
      leadPhone: schema.leads.phone,
      brand: schema.vehicles.brand,
      model: schema.vehicles.model,
      year: schema.vehicles.year,
      timezone: schema.agencies.timezone,
    })
    .from(schema.appointments)
    .leftJoin(schema.leads, eq(schema.leads.id, schema.appointments.leadId))
    .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.appointments.vehicleId))
    .innerJoin(schema.agencies, eq(schema.agencies.id, schema.appointments.agencyId))
    .where(eq(schema.appointments.id, appointmentId))
    .limit(1);

  if (!appointment) return;

  const recipients = await recipientsFor(message.agencyId, appointment.assignedTo);
  if (recipients.length === 0) return;

  const when = new Intl.DateTimeFormat('es-AR', {
    timeZone: appointment.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(appointment.startsAt);

  const vehicle = appointment.brand
    ? `${appointment.brand} ${appointment.model} ${appointment.year}`
    : null;

  await email.send({
    to: recipients,
    subject: `Turno agendado: ${when}`,
    text: [
      `Se agendó ${TYPE_WORDS[appointment.type] ?? 'un turno'} para el ${when}.`,
      appointment.leadName ? `Con: ${appointment.leadName}` : null,
      appointment.leadPhone ? `Teléfono: ${appointment.leadPhone}` : null,
      vehicle ? `Vehículo: ${vehicle}` : null,
      appointment.notes ? `\nNotas:\n${appointment.notes}` : null,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  });
}

const TYPE_WORDS: Record<string, string> = {
  VISIT: 'una visita',
  TEST_DRIVE: 'una prueba de manejo',
  DELIVERY: 'una entrega',
  APPRAISAL: 'una tasación',
};

/**
 * A quién avisar: a la persona asignada si la hay, y si no a quienes
 * administran la agencia. Mandarle a todo el equipo cada consulta es la
 * forma más rápida de que dejen de leer los mails.
 */
async function recipientsFor(agencyId: string, assignedTo: string | null): Promise<string[]> {
  const rows = await dbAdmin
    .select({ email: schema.users.email })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.agencyId, agencyId),
        eq(schema.memberships.status, 'ACTIVE'),
        assignedTo
          ? eq(schema.memberships.userId, assignedTo)
          : inArray(schema.memberships.role, ['OWNER', 'ADMIN']),
      ),
    );

  // Las direcciones de prueba del seed no reciben nada.
  return rows.map((r) => r.email).filter((email) => !email.endsWith('.test'));
}
