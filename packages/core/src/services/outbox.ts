import { and, asc, dbAdmin, eq, lte, schema, sql, type Tx } from '@cuasar/db';

/**
 * La cola de salida.
 *
 * Todo lo que tiene que salir al mundo —un mail, una publicación en
 * MercadoLibre, un evento en Google Calendar— se encola acá dentro de la
 * misma transacción que el cambio que lo provoca. Después un worker la drena.
 *
 * Sirve para dos cosas. Una: el dominio no importa ningún SDK de tercero, así
 * que agregar un proveedor es escribir un adapter y nada más. Dos: si el
 * proveedor está caído, la operación del usuario igual se completó, y el
 * mensaje se reintenta solo. Lo contrario —mandar el mail adentro del request
 * y fallar la operación cuando el proveedor no contesta— es peor de las dos
 * maneras: el usuario ve un error y el cambio quedó a medias.
 */

const { outbox } = schema;

export type OutboxTopic = 'lead.received' | 'appointment.scheduled' | 'appointment.reminder';

export type OutboxMessage = {
  id: string;
  agencyId: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
};

/** Se encola con la transacción abierta: o entran las dos cosas, o ninguna. */
export async function enqueue(
  tx: Tx,
  agencyId: string,
  topic: OutboxTopic,
  payload: Record<string, unknown>,
) {
  await tx.insert(outbox).values({ agencyId, topic, payload });
}

/**
 * Toma un lote pendiente y lo marca en curso en una sola sentencia.
 *
 * `for update skip locked` es lo que permite que dos workers corran a la vez
 * sin mandar el mismo mail dos veces: el segundo saltea las filas que el
 * primero ya tomó, en lugar de esperarlas.
 */
export async function claimBatch(limit = 20): Promise<OutboxMessage[]> {
  const rows = await dbAdmin.execute<{
    id: string;
    agency_id: string;
    topic: string;
    payload: Record<string, unknown>;
    attempts: number;
  }>(sql`
    update outbox
    set status = 'PROCESSING', attempts = attempts + 1
    where id in (
      select id from outbox
      where status = 'PENDING' and next_attempt_at <= now()
      order by next_attempt_at
      limit ${limit}
      for update skip locked
    )
    returning id, agency_id, topic, payload, attempts
  `);

  return rows.map((r) => ({
    id: r.id,
    agencyId: r.agency_id,
    topic: r.topic,
    payload: r.payload ?? {},
    attempts: r.attempts,
  }));
}

export async function markDone(id: string) {
  await dbAdmin
    .update(outbox)
    .set({ status: 'DONE', processedAt: new Date(), lastError: null })
    .where(eq(outbox.id, id));
}

/** Máximo de intentos antes de rendirse y dejarlo para revisión manual. */
const MAX_ATTEMPTS = 6;

export async function markFailed(id: string, attempts: number, error: string) {
  const givenUp = attempts >= MAX_ATTEMPTS;

  // Espera creciente: 1, 2, 4, 8… minutos. Reintentar cada segundo contra un
  // proveedor caído no lo levanta y sí gasta la cuota.
  const backoffMinutes = Math.min(2 ** (attempts - 1), 60);

  await dbAdmin
    .update(outbox)
    .set({
      status: givenUp ? 'FAILED' : 'PENDING',
      lastError: error.slice(0, 500),
      nextAttemptAt: sql`now() + make_interval(mins => ${backoffMinutes})`,
    })
    .where(eq(outbox.id, id));
}

/** Los que se rindieron, para que el panel de plataforma pueda mirarlos. */
export async function listFailed(limit = 50) {
  return dbAdmin
    .select({
      id: outbox.id,
      agencyId: outbox.agencyId,
      topic: outbox.topic,
      attempts: outbox.attempts,
      lastError: outbox.lastError,
      createdAt: outbox.createdAt,
    })
    .from(outbox)
    .where(and(eq(outbox.status, 'FAILED'), lte(outbox.createdAt, new Date())))
    .orderBy(asc(outbox.createdAt))
    .limit(limit);
}
