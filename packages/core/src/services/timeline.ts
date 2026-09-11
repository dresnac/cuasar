import { desc, eq, lt, and, schema, withTenant, type TenantCtx } from '@cuasar/db';
import { ok, type Result } from '../errors';

const { vehicleEvents, users } = schema;

export type TimelineEntry = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  actorName: string | null;
  source: string;
};

/**
 * El timeline completo de un vehículo, del más reciente al más viejo.
 * Paginado por keyset sobre el id: como son UUIDv7, el orden por id es el
 * orden temporal y no hace falta una segunda columna de desempate.
 */
export async function listTimeline(
  ctx: TenantCtx,
  vehicleId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<Result<{ entries: TimelineEntry[]; nextCursor: string | null }>> {
  const limit = Math.min(opts.limit ?? 30, 100);

  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({
        id: vehicleEvents.id,
        type: vehicleEvents.type,
        payload: vehicleEvents.payload,
        occurredAt: vehicleEvents.occurredAt,
        source: vehicleEvents.source,
        actorName: users.name,
      })
      .from(vehicleEvents)
      .leftJoin(users, eq(users.id, vehicleEvents.actorUserId))
      .where(
        and(
          eq(vehicleEvents.vehicleId, vehicleId),
          opts.before ? lt(vehicleEvents.id, opts.before) : undefined,
        ),
      )
      .orderBy(desc(vehicleEvents.id))
      .limit(limit + 1),
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return ok({
    entries: page.map((r) => ({
      id: r.id,
      type: r.type,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      occurredAt: r.occurredAt,
      actorName: r.actorName,
      source: r.source,
    })),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  });
}
