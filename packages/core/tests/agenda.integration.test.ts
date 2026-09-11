import { dbAdmin, pgClient, schema, sql, type TenantCtx } from '@cuasar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anonymizeLead,
  assignLead,
  createAppointment,
  getAvailability,
  listAppointments,
  listLeads,
  listTimeline,
  rescheduleAppointment,
  setAppointmentStatus,
  setLeadStatus,
  suggestSlots,
} from '../src/services';

/**
 * Bandeja de consultas y agenda.
 *
 * El nudo de estos tests es la regla de visibilidad: un vendedor ve lo que
 * está libre y lo suyo, nunca lo de un compañero. No es seguridad —siguen
 * siendo de la misma agencia— es evitar que dos personas llamen al mismo
 * interesado o esperen al mismo cliente.
 *
 * Requiere: pnpm db:migrate && pnpm db:seed
 */

let owner: TenantCtx;
let sales: TenantCtx;
let otherSales: TenantCtx;
let agencyId: string;
let timezone: string;
const madeAppointments: string[] = [];
const madeLeads: string[] = [];

const at = (daysFromNow: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d;
};

/**
 * Un día hábil bien adelante en el calendario.
 *
 * Los tests trabajan sobre una ventana propia, lejos de los turnos del seed,
 * y la limpian antes y después. Si usaran "mañana", una corrida dejaría
 * ocupado el horario que la siguiente necesita libre, y el segundo `pnpm test`
 * fallaría sin que nada hubiera cambiado en el código.
 */
const WINDOW_START_DAYS = 30;

function nextWeekday(hour: number) {
  for (let i = WINDOW_START_DAYS; i < WINDOW_START_DAYS + 8; i++) {
    const d = at(i, hour);
    const day = d.getDay();
    if (day >= 1 && day <= 5) return d;
  }
  return at(WINDOW_START_DAYS, hour);
}

/** Deja la ventana de prueba sin turnos, venga de donde venga. */
async function clearWindow(agency: string) {
  await dbAdmin.execute(sql`
    delete from appointments
    where agency_id = ${agency}
      and starts_at >= now() + make_interval(days => ${WINDOW_START_DAYS - 1})
      and starts_at <  now() + make_interval(days => ${WINDOW_START_DAYS + 10})
  `);
}

beforeAll(async () => {
  const [agency] = await dbAdmin.execute<{ id: string; timezone: string }>(
    sql`select id, timezone from agencies where slug = 'del-sur' limit 1`,
  );
  if (!agency) throw new Error('Falta el seed: pnpm db:seed');
  agencyId = agency.id;
  timezone = agency.timezone;

  const members = await dbAdmin.execute<{ user_id: string; role: string }>(
    sql`select user_id, role from memberships where agency_id = ${agencyId}`,
  );

  owner = { agencyId, userId: members.find((m) => m.role === 'OWNER')!.user_id, role: 'OWNER' };
  sales = { agencyId, userId: members.find((m) => m.role === 'SALES')!.user_id, role: 'SALES' };

  // Un segundo vendedor, para probar que no se pisan entre ellos.
  const [extra] = await dbAdmin
    .insert(schema.users)
    .values({ externalId: `test_sales_${Date.now()}`, email: 'otro@delsur.test', name: 'Otro Vendedor' })
    .returning();

  await dbAdmin.insert(schema.memberships).values({
    agencyId,
    userId: extra!.id,
    role: 'SALES',
    status: 'ACTIVE',
    activatedAt: new Date(),
  });

  otherSales = { agencyId, userId: extra!.id, role: 'SALES' };

  await clearWindow(agencyId);
});

afterAll(async () => {
  await clearWindow(agencyId);
  if (madeLeads.length) {
    await dbAdmin.execute(sql`delete from leads where id = any(${sql`array[${sql.join(
      madeLeads.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]`})`);
  }
  await dbAdmin.execute(sql`delete from users where email = 'otro@delsur.test'`);
  await pgClient.end();
});

describe('bandeja de consultas', () => {
  it('un vendedor ve las libres y las suyas, no las de un compañero', async () => {
    const all = await listLeads(owner, {});
    if (!all.ok) throw new Error('falló el listado');
    const target = all.data.find((l) => l.id)!;

    await assignLead(owner, target.id, otherSales.userId);

    const mine = await listLeads(sales, {});
    if (!mine.ok) throw new Error('falló el listado');
    expect(mine.data.some((l) => l.id === target.id)).toBe(false);

    // El dueño sí la ve: necesita poder repartir el trabajo.
    const asOwner = await listLeads(owner, {});
    if (!asOwner.ok) throw new Error('falló el listado');
    expect(asOwner.data.some((l) => l.id === target.id)).toBe(true);

    await assignLead(owner, target.id, null);
  });

  it('un vendedor puede tomar una consulta libre', async () => {
    const all = await listLeads(owner, { assignedTo: 'unassigned' });
    if (!all.ok || all.data.length === 0) throw new Error('se esperaba una consulta libre');

    const lead = all.data[0]!;
    expect((await assignLead(sales, lead.id, sales.userId)).ok).toBe(true);

    const after = await listLeads(sales, {});
    if (!after.ok) throw new Error('falló el listado');
    expect(after.data.find((l) => l.id === lead.id)?.assignedTo).toBe(sales.userId);

    await assignLead(owner, lead.id, null);
  });

  it('pero no puede sacarle una consulta a otro vendedor', async () => {
    const all = await listLeads(owner, {});
    if (!all.ok) throw new Error('falló el listado');
    const lead = all.data[0]!;

    await assignLead(owner, lead.id, otherSales.userId);

    const stolen = await assignLead(sales, lead.id, sales.userId);
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.error.code).toBe('FORBIDDEN');

    await assignLead(owner, lead.id, null);
  });

  it('cerrar una consulta como ganada queda en la historia del vehículo', async () => {
    const all = await listLeads(owner, {});
    if (!all.ok) throw new Error('falló el listado');
    const lead = all.data.find((l) => l.vehicleId)!;

    expect((await setLeadStatus(owner, lead.id, 'WON')).ok).toBe(true);

    const timeline = await listTimeline(owner, lead.vehicleId!);
    if (!timeline.ok) throw new Error('falló el timeline');
    expect(timeline.data.entries[0]?.payload.leadId).toBe(lead.id);

    await setLeadStatus(owner, lead.id, 'NEW');
  });

  it('anonimizar borra el contacto sin romper el historial', async () => {
    const [lead] = await dbAdmin
      .insert(schema.leads)
      .values({
        agencyId,
        name: 'Para anonimizar',
        phone: '+54 9 11 5555 5555',
        email: 'borrar@example.com',
        source: 'MANUAL',
      })
      .returning({ id: schema.leads.id });

    madeLeads.push(lead!.id);

    const bySales = await anonymizeLead(sales, lead!.id);
    expect(bySales.ok).toBe(false);

    expect((await anonymizeLead(owner, lead!.id)).ok).toBe(true);

    const [after] = await dbAdmin.execute<{ name: string; phone: string | null }>(
      sql`select name, phone from leads where id = ${lead!.id}`,
    );
    expect(after!.phone).toBeNull();
    expect(after!.name).toBe('Consulta anonimizada');
  });
});

describe('agenda', () => {
  it('agenda un turno y lo suma a la historia del vehículo', async () => {
    const [vehicle] = await dbAdmin.execute<{ id: string }>(
      sql`select id from vehicles where agency_id = ${agencyId} and status = 'PUBLICADO' limit 1`,
    );

    const result = await createAppointment(owner, {
      type: 'TEST_DRIVE',
      startsAt: nextWeekday(10),
      durationMinutes: 60,
      vehicleId: vehicle!.id,
      assignedTo: sales.userId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    madeAppointments.push(result.data.id);

    const timeline = await listTimeline(owner, vehicle!.id);
    if (!timeline.ok) throw new Error('falló el timeline');
    expect(timeline.data.entries[0]?.type).toBe('APPOINTMENT_SCHEDULED');
  });

  it('no deja dos turnos encimados de la misma persona', async () => {
    const clash = await createAppointment(owner, {
      startsAt: nextWeekday(10).getTime() + 30 * 60_000,
      durationMinutes: 60,
      assignedTo: sales.userId,
    });

    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error.code).toBe('CONFLICT');
  });

  it('pero sí dos turnos seguidos: el rango es semiabierto', async () => {
    const back2back = await createAppointment(owner, {
      startsAt: nextWeekday(11),
      durationMinutes: 60,
      assignedTo: sales.userId,
    });

    expect(back2back.ok).toBe(true);
    if (back2back.ok) madeAppointments.push(back2back.data.id);
  });

  it('dos personas distintas sí pueden estar ocupadas a la misma hora', async () => {
    const parallel = await createAppointment(owner, {
      startsAt: nextWeekday(10),
      durationMinutes: 60,
      assignedTo: otherSales.userId,
    });

    expect(parallel.ok).toBe(true);
    if (parallel.ok) madeAppointments.push(parallel.data.id);
  });

  it('mover un turno encima de otro también se rechaza', async () => {
    const moved = await rescheduleAppointment(
      owner,
      madeAppointments[1]!,
      nextWeekday(10),
      60,
    );
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.code).toBe('CONFLICT');
  });

  it('agendar sobre una consulta nueva la marca como calificada', async () => {
    const [lead] = await dbAdmin
      .insert(schema.leads)
      .values({ agencyId, name: 'Interesado', phone: '+54 9 11 4444 4444', source: 'PHONE' })
      .returning({ id: schema.leads.id });
    madeLeads.push(lead!.id);

    const result = await createAppointment(owner, {
      startsAt: nextWeekday(15),
      leadId: lead!.id,
      assignedTo: owner.userId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) madeAppointments.push(result.data.id);

    const [after] = await dbAdmin.execute<{ status: string }>(
      sql`select status from leads where id = ${lead!.id}`,
    );
    expect(after!.status).toBe('QUALIFIED');
  });

  it('un vendedor ve su agenda, no la de un compañero', async () => {
    const from = new Date();
    const to = new Date(Date.now() + 60 * 86_400_000);

    const asOther = await listAppointments(otherSales, { from, to });
    if (!asOther.ok) throw new Error('falló la agenda');

    // El turno de `sales` no aparece en la agenda de `otherSales`.
    expect(asOther.data.some((a) => a.assignedTo === sales.userId)).toBe(false);

    const asOwner = await listAppointments(owner, { from, to });
    if (!asOwner.ok) throw new Error('falló la agenda');
    expect(asOwner.data.some((a) => a.assignedTo === sales.userId)).toBe(true);
  });

  it('cancelar saca el turno de la agenda y libera el horario', async () => {
    const id = madeAppointments[0]!;
    expect((await setAppointmentStatus(owner, id, 'CANCELLED')).ok).toBe(true);

    const libre = await createAppointment(owner, {
      startsAt: nextWeekday(10),
      durationMinutes: 60,
      assignedTo: sales.userId,
    });
    expect(libre.ok).toBe(true);
    if (libre.ok) madeAppointments.push(libre.data.id);
  });
});

describe('horarios libres', () => {
  it('los huecos caen dentro del horario de atención', async () => {
    expect((await getAvailability(owner)).length).toBeGreaterThan(0);

    const date = nextWeekday(10).toISOString().slice(0, 10);
    const slots = await suggestSlots(owner, { date, timezone, assignedTo: otherSales.userId });

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const hour = Number(
        new Intl.DateTimeFormat('es-AR', { timeZone: timezone, hour: '2-digit', hour12: false })
          .format(slot.startsAt),
      );
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(18);
    }
  });

  it('no ofrece un horario que ya está ocupado', async () => {
    const taken = nextWeekday(10);
    const date = taken.toISOString().slice(0, 10);

    const slots = await suggestSlots(owner, { date, timezone, assignedTo: otherSales.userId });
    expect(slots.some((s) => s.startsAt.getTime() === taken.getTime())).toBe(false);
  });

  it('un domingo no tiene horarios', async () => {
    const sunday = new Date();
    sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7 || 7));

    const slots = await suggestSlots(owner, {
      date: sunday.toISOString().slice(0, 10),
      timezone,
    });
    expect(slots).toHaveLength(0);
  });
});
