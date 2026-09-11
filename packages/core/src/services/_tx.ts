import { schema, type Tx } from '@cuasar/db';
import type { TenantCtx } from '@cuasar/db';

export type EventType = (typeof schema.eventType.enumValues)[number];

/**
 * Escribe en el timeline.
 *
 * Siempre dentro de la misma transacción que el cambio que describe: si el
 * evento falla, el cambio no ocurrió. El timeline es la fuente de verdad
 * histórica y no puede quedar con agujeros.
 *
 * El payload guarda datos personales por referencia (ids), nunca copiados:
 * borrar un lead tiene que poder anonimizarlo sin romper el historial.
 */
export async function appendEvent(
  tx: Tx,
  ctx: TenantCtx,
  event: {
    vehicleId: string;
    type: EventType;
    payload?: Record<string, unknown>;
    source?: (typeof schema.eventSource.enumValues)[number];
  },
) {
  await tx.insert(schema.vehicleEvents).values({
    agencyId: ctx.agencyId,
    vehicleId: event.vehicleId,
    type: event.type,
    payload: event.payload ?? {},
    actorUserId: ctx.userId,
    source: event.source ?? 'WEB',
  });
}

/** Diff superficial para el evento VEHICLE_UPDATED: qué cambió y a qué. */
export function diffOf<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(after)) {
    if (value !== undefined && before[key] !== value) {
      changes[key] = { from: before[key], to: value };
    }
  }
  return changes;
}

export function slugify(input: string) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
