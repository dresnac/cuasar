import { dbAdmin, pgClient, schema, sql } from '@cuasar/db';
import { createPublicLead, listFailed } from '@cuasar/core/services';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drainOutbox } from '../src/notifications';
import type { EmailMessage, EmailPort } from '../src/email';

/**
 * La cola de salida, de punta a punta.
 *
 * Lo que se prueba no es que el mail se vea lindo: es que encolar sea parte
 * de la transacción, que dos workers no manden dos veces lo mismo, que un
 * proveedor caído no pierda el mensaje, y que una consulta anonimizada entre
 * que entró y que salió el mail no termine filtrada en el mail.
 *
 * Requiere: pnpm db:migrate && pnpm db:seed
 */

class FakeEmail implements EmailPort {
  readonly name = 'fake';
  readonly sent: EmailMessage[] = [];
  shouldFail = false;

  async send(message: EmailMessage) {
    if (this.shouldFail) throw new Error('el proveedor no contesta');
    this.sent.push(message);
  }
}

let agencyId: string;

beforeAll(async () => {
  const [agency] = await dbAdmin.execute<{ id: string }>(
    sql`select id from agencies where slug = 'del-sur' limit 1`,
  );
  if (!agency) throw new Error('Falta el seed: pnpm db:seed');
  agencyId = agency.id;

  // Los mails del seed terminan en .test y se filtran a propósito; para estos
  // tests hace falta un destinatario que el worker acepte.
  await dbAdmin.execute(sql`
    update users set email = 'owner+test@cuasar.example'
    where email = 'owner@delsur.test'
  `);
});

beforeEach(async () => {
  await dbAdmin.execute(sql`delete from outbox where agency_id = ${agencyId}`);
  await dbAdmin.execute(sql`delete from leads where phone like '+54 9 11 COLA%'`);
});

afterAll(async () => {
  await dbAdmin.execute(sql`
    update users set email = 'owner@delsur.test' where email = 'owner+test@cuasar.example'
  `);
  await dbAdmin.execute(sql`delete from outbox where agency_id = ${agencyId}`);
  await dbAdmin.execute(sql`delete from leads where phone like '+54 9 11 COLA%'`);
  await pgClient.end();
});

async function leaveLead(phone: string) {
  const result = await createPublicLead(agencyId, {
    name: 'Interesado de prueba',
    phone,
    message: 'Quiero saber si acepta permuta.',
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data.id;
}

describe('cola de salida', () => {
  it('recibir una consulta encola la notificación en la misma operación', async () => {
    await leaveLead('+54 9 11 COLA 001');

    const [row] = await dbAdmin.execute<{ topic: string; status: string }>(
      sql`select topic, status from outbox where agency_id = ${agencyId}`,
    );
    expect(row?.topic).toBe('lead.received');
    expect(row?.status).toBe('PENDING');
  });

  it('el worker manda y marca el mensaje como hecho', async () => {
    await leaveLead('+54 9 11 COLA 002');

    const email = new FakeEmail();
    const result = await drainOutbox(10, email);

    expect(result.sent).toBe(1);
    expect(email.sent[0]?.subject).toMatch(/consulta/i);
    expect(email.sent[0]?.text).toContain('+54 9 11 COLA 002');

    const [row] = await dbAdmin.execute<{ status: string }>(
      sql`select status from outbox where agency_id = ${agencyId}`,
    );
    expect(row?.status).toBe('DONE');
  });

  it('un segundo worker no vuelve a mandar lo que el primero ya tomó', async () => {
    await leaveLead('+54 9 11 COLA 003');

    const first = new FakeEmail();
    const second = new FakeEmail();

    // En serie alcanza para probar el efecto: el primero deja la fila fuera
    // de PENDING, así que el segundo no encuentra nada que tomar.
    await drainOutbox(10, first);
    await drainOutbox(10, second);

    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(0);
  });

  it('si el proveedor falla, el mensaje vuelve a la cola con espera creciente', async () => {
    await leaveLead('+54 9 11 COLA 004');

    const email = new FakeEmail();
    email.shouldFail = true;

    const result = await drainOutbox(10, email);
    expect(result.failed).toBe(1);

    const [row] = await dbAdmin.execute<{
      status: string;
      attempts: number;
      last_error: string;
      pendiente_en_el_futuro: boolean;
    }>(sql`
      select status, attempts, last_error, next_attempt_at > now() as pendiente_en_el_futuro
      from outbox where agency_id = ${agencyId}
    `);

    expect(row?.status).toBe('PENDING');
    expect(row?.attempts).toBe(1);
    expect(row?.last_error).toMatch(/no contesta/);
    expect(row?.pendiente_en_el_futuro).toBe(true);
  });

  it('después de seis intentos se rinde y queda para revisión', async () => {
    await leaveLead('+54 9 11 COLA 005');

    await dbAdmin.execute(sql`
      update outbox set attempts = 5, next_attempt_at = now() where agency_id = ${agencyId}
    `);

    const email = new FakeEmail();
    email.shouldFail = true;
    await drainOutbox(10, email);

    const [row] = await dbAdmin.execute<{ status: string }>(
      sql`select status from outbox where agency_id = ${agencyId}`,
    );
    expect(row?.status).toBe('FAILED');
    expect((await listFailed()).some((f) => f.agencyId === agencyId)).toBe(true);
  });

  it('una consulta anonimizada antes de que salga el mail no se filtra en el mail', async () => {
    const leadId = await leaveLead('+54 9 11 COLA 006');

    await dbAdmin
      .update(schema.leads)
      .set({ anonymizedAt: new Date(), phone: null, name: 'Consulta anonimizada' })
      .where(sql`id = ${leadId}`);

    const email = new FakeEmail();
    await drainOutbox(10, email);

    // No manda nada, y el mensaje igual se cierra: no hay nada que reintentar.
    expect(email.sent).toHaveLength(0);
    const [row] = await dbAdmin.execute<{ status: string }>(
      sql`select status from outbox where agency_id = ${agencyId}`,
    );
    expect(row?.status).toBe('DONE');
  });
});
