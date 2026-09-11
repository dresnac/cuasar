import { and, asc, desc, eq, schema, sql, withTenant, type TenantCtx } from '@cuasar/db';
import { z } from 'zod';
import { fail, ok, type Result } from '../errors';
import { can } from '../permissions';
import { appendEvent } from './_tx';

const { vehicleImages, vehicles } = schema;

/** Tope por unidad: más fotos no venden más y sí cuestan egress y tiempo de carga. */
export const MAX_IMAGES_PER_VEHICLE = 40;

export const imageInput = z.object({
  blobUrl: z.string().url(),
  blobPathname: z.string().min(1),
  width: z.coerce.number().int().positive(),
  height: z.coerce.number().int().positive(),
  bytes: z.coerce.number().int().positive(),
  blurDataUrl: z.string().nullish(),
});

export type ImageInput = z.infer<typeof imageInput>;

export async function attachImages(
  ctx: TenantCtx,
  vehicleId: string,
  raw: unknown,
): Promise<Result<{ added: number }>> {
  if (!can(ctx.role, 'vehicle:write')) return fail('FORBIDDEN', 'No podés cargar fotos.');

  const parsed = z.array(imageInput).min(1).safeParse(raw);
  if (!parsed.success) return fail('VALIDATION', 'Las fotos no son válidas.');

  return withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(position), -1)` })
      .from(vehicleImages)
      .where(eq(vehicleImages.vehicleId, vehicleId));

    const current = existing?.n ?? 0;
    if (current + parsed.data.length > MAX_IMAGES_PER_VEHICLE) {
      return fail<{ added: number }>(
        'QUOTA_EXCEEDED',
        `Máximo ${MAX_IMAGES_PER_VEHICLE} fotos por vehículo.`,
      );
    }

    await tx.insert(vehicleImages).values(
      parsed.data.map((img, i) => ({
        agencyId: ctx.agencyId,
        vehicleId,
        blobUrl: img.blobUrl,
        blobPathname: img.blobPathname,
        width: img.width,
        height: img.height,
        bytes: img.bytes,
        blurDataUrl: img.blurDataUrl ?? null,
        position: (existing?.max ?? -1) + 1 + i,
        // La primera foto que entra es la portada hasta que alguien diga otra cosa.
        isCover: current === 0 && i === 0,
      })),
    );

    await appendEvent(tx, ctx, {
      vehicleId,
      type: 'IMAGES_ADDED',
      payload: { count: parsed.data.length },
    });

    return ok({ added: parsed.data.length });
  });
}

export async function removeImage(
  ctx: TenantCtx,
  vehicleId: string,
  imageId: string,
): Promise<Result<{ blobPathname: string }>> {
  if (!can(ctx.role, 'vehicle:write')) return fail('FORBIDDEN', 'No podés borrar fotos.');

  return withTenant(ctx, async (tx) => {
    const [deleted] = await tx
      .delete(vehicleImages)
      .where(and(eq(vehicleImages.id, imageId), eq(vehicleImages.vehicleId, vehicleId)))
      .returning({ pathname: vehicleImages.blobPathname, wasCover: vehicleImages.isCover });

    if (!deleted) return fail<{ blobPathname: string }>('NOT_FOUND', 'La foto no existe.');

    // Un vehículo publicado sin portada rompe el catálogo: si se borró la
    // portada, la siguiente foto la reemplaza en la misma transacción.
    if (deleted.wasCover) {
      const [next] = await tx
        .select({ id: vehicleImages.id })
        .from(vehicleImages)
        .where(eq(vehicleImages.vehicleId, vehicleId))
        .orderBy(asc(vehicleImages.position))
        .limit(1);

      if (next) {
        await tx.update(vehicleImages).set({ isCover: true }).where(eq(vehicleImages.id, next.id));
      }
    }

    await appendEvent(tx, ctx, { vehicleId, type: 'IMAGES_REMOVED', payload: { imageId } });

    return ok({ blobPathname: deleted.pathname });
  });
}

export async function setCover(
  ctx: TenantCtx,
  vehicleId: string,
  imageId: string,
): Promise<Result<true>> {
  if (!can(ctx.role, 'vehicle:write')) return fail('FORBIDDEN', 'No podés cambiar la portada.');

  return withTenant(ctx, async (tx) => {
    await tx
      .update(vehicleImages)
      .set({ isCover: false })
      .where(eq(vehicleImages.vehicleId, vehicleId));

    const [updated] = await tx
      .update(vehicleImages)
      .set({ isCover: true })
      .where(and(eq(vehicleImages.id, imageId), eq(vehicleImages.vehicleId, vehicleId)))
      .returning({ id: vehicleImages.id });

    if (!updated) return fail<true>('NOT_FOUND', 'La foto no existe.');
    return ok(true as const);
  });
}

export async function reorderImages(
  ctx: TenantCtx,
  vehicleId: string,
  orderedIds: string[],
): Promise<Result<true>> {
  if (!can(ctx.role, 'vehicle:write')) return fail('FORBIDDEN', 'No podés reordenar las fotos.');

  return withTenant(ctx, async (tx) => {
    for (const [position, id] of orderedIds.entries()) {
      await tx
        .update(vehicleImages)
        .set({ position })
        .where(and(eq(vehicleImages.id, id), eq(vehicleImages.vehicleId, vehicleId)));
    }
    return ok(true as const);
  });
}

/** Las fotos que ya tiene un vehículo; el uploader necesita saber cuántas quedan. */
export async function countImages(ctx: TenantCtx, vehicleId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(vehicleImages)
      .where(eq(vehicleImages.vehicleId, vehicleId));
    return row?.n ?? 0;
  });
}

/** Verifica que el vehículo sea de la agencia antes de emitir un token de subida. */
export async function vehicleBelongsToAgency(ctx: TenantCtx, vehicleId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);
    return Boolean(row);
  });
}
