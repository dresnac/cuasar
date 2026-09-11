import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  schema,
  sql,
  withTenant,
  type TenantCtx,
  type Tx,
} from '@cuasar/db';
import { z } from 'zod';
import { fail, ok, type Result } from '../errors';
import { can, canSeeFinancials } from '../permissions';
import {
  assertTransition,
  daysInStock,
  type Ownership,
  type VehicleStatus,
  VEHICLE_STATUSES,
} from '../vehicle-state';
import { appendEvent, diffOf, slugify } from './_tx';

const { vehicles, vehicleImages, vehicleAcquisitions, vehicleFinancials, consignments } = schema;

/**
 * Antigüedad en stock, en segundos. Una unidad vendida congela el contador
 * en la fecha de venta: ya no está parada, así que no debería encabezar la
 * lista de "lo que no se mueve".
 *
 * Es la misma definición que usa `daysInStock` en el dominio; si el orden
 * usara otra, la lista se vería ordenada al revés de lo que muestra.
 */
const STOCK_AGE_SECONDS = sql<number>`extract(epoch from (
  coalesce("vehicles"."sold_at", now()) - "vehicles"."acquired_at"
))`;

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

const moneyInput = z.object({
  amountCents: z.coerce.bigint().positive(),
  currency: z.enum(['USD', 'ARS']),
  fxRate: z.string().default('1'),
  amountBaseCents: z.coerce.bigint().nonnegative(),
});

export const vehicleInput = z.object({
  brand: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  version: z.string().max(80).nullish(),
  year: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 2),
  km: z.coerce.number().int().min(0).max(2_000_000).default(0),
  fuel: z.enum(schema.fuelType.enumValues).nullish(),
  transmission: z.enum(schema.transmissionType.enumValues).nullish(),
  color: z.string().max(40).nullish(),
  doors: z.coerce.number().int().min(2).max(7).nullish(),
  licensePlate: z.string().max(10).nullish(),
  vin: z.string().max(20).nullish(),
  description: z.string().max(4000).nullish(),
  features: z.array(z.string().max(60)).max(40).default([]),
  ownership: z.enum(['OWNED', 'CONSIGNMENT']),
  listPrice: moneyInput,
  floorPriceCents: z.coerce.bigint().nonnegative().nullish(),
  acquiredAt: z.coerce.date().default(() => new Date()),
  /** Obligatorio si ownership es CONSIGNMENT. */
  acquisition: moneyInput.nullish(),
  consignment: z
    .object({
      consignorName: z.string().min(1).max(120),
      consignorDoc: z.string().max(20).nullish(),
      consignorPhone: z.string().max(30).nullish(),
      consignorEmail: z.string().email().nullish(),
      agreedFloor: moneyInput,
      commissionType: z.enum(['PCT', 'FIXED']),
      commissionValue: z.string(),
      contractStartsAt: z.string(),
      contractEndsAt: z.string().nullish(),
    })
    .nullish(),
});

export type VehicleInput = z.infer<typeof vehicleInput>;

export const vehicleFilters = z.object({
  status: z.array(z.enum(VEHICLE_STATUSES)).optional(),
  ownership: z.enum(['OWNED', 'CONSIGNMENT']).optional(),
  brand: z.string().optional(),
  q: z.string().max(80).optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  sort: z.enum(['recent', 'oldest', 'price_asc', 'price_desc', 'stale']).default('recent'),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  /** Keyset, no OFFSET: el listado no se degrada cuando la agencia crece. */
  cursor: z.string().optional(),
});

export type VehicleFilters = z.infer<typeof vehicleFilters>;

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type VehicleListItem = {
  id: string;
  brand: string;
  model: string;
  version: string | null;
  year: number;
  km: number;
  licensePlate: string | null;
  status: VehicleStatus;
  ownership: Ownership;
  listPriceAmountCents: bigint;
  listPriceCurrency: string;
  coverUrl: string | null;
  imageCount: number;
  daysInStock: number;
  daysInStatus: number;
  /** Solo para quien puede ver plata: SALES recibe null. */
  investedBaseCents: bigint | null;
  marginBaseCents: bigint | null;
};

export async function listVehicles(
  ctx: TenantCtx,
  rawFilters: unknown,
): Promise<Result<{ items: VehicleListItem[]; nextCursor: string | null }>> {
  const parsed = vehicleFilters.safeParse(rawFilters ?? {});
  if (!parsed.success) return fail('VALIDATION', 'Filtros inválidos', { issues: parsed.error.issues });

  const f = parsed.data;
  const showMoney = canSeeFinancials(ctx.role);

  const rows = await withTenant(ctx, async (tx) => {
    const where = [
      f.status?.length ? inArray(vehicles.status, f.status) : undefined,
      f.ownership ? eq(vehicles.ownership, f.ownership) : undefined,
      f.brand ? eq(vehicles.brand, f.brand) : undefined,
      f.yearFrom ? gte(vehicles.year, f.yearFrom) : undefined,
      f.yearTo ? lte(vehicles.year, f.yearTo) : undefined,
      f.q
        ? or(
            ilike(vehicles.brand, `%${f.q}%`),
            ilike(vehicles.model, `%${f.q}%`),
            ilike(vehicles.version, `%${f.q}%`),
            ilike(vehicles.licensePlate, `%${f.q}%`),
          )
        : undefined,
      cursorClause(f),
    ].filter(Boolean);

    return tx
      .select({
        id: vehicles.id,
        brand: vehicles.brand,
        model: vehicles.model,
        version: vehicles.version,
        year: vehicles.year,
        km: vehicles.km,
        licensePlate: vehicles.licensePlate,
        status: vehicles.status,
        ownership: vehicles.ownership,
        listPriceAmountCents: vehicles.listPriceAmountCents,
        listPriceCurrency: vehicles.listPriceCurrency,
        acquiredAt: vehicles.acquiredAt,
        soldAt: vehicles.soldAt,
        statusChangedAt: vehicles.statusChangedAt,
        createdAt: vehicles.createdAt,
        // Dos reglas en estas subconsultas correlacionadas, las dos aprendidas
        // a golpes: alias explícito (sin él dos columnas pueden volver con el
        // mismo nombre y el mapeo devuelve otro valor), y la columna externa
        // escrita calificada. Interpolar ${vehicles.id} la renderiza como "id"
        // a secas, que adentro del subselect resuelve a vehicle_images.id:
        // la consulta no falla, simplemente contesta cero.
        coverUrl: sql<string | null>`(
          select i.blob_url from vehicle_images i
          where i.vehicle_id = "vehicles"."id"
          order by i.is_cover desc, i.position asc limit 1
        )`.as('cover_url'),
        imageCount: sql<number>`(
          select count(*)::int from vehicle_images i where i.vehicle_id = "vehicles"."id"
        )`.as('image_count'),
        stockAgeSeconds: STOCK_AGE_SECONDS.as('stock_age_seconds'),
        // La suma se hace en TS y no en SQL a propósito: un fragmento crudo
        // no lleva el tipo de la columna, así que un bigint de Postgres
        // llegaría como string y las comparaciones de plata mentirían.
        acquisitionBaseCents: showMoney
          ? vehicleFinancials.acquisitionBaseCents
          : sql<null>`null`.as('acquisition_base_cents'),
        costsBaseCents: showMoney
          ? vehicleFinancials.costsBaseCents
          : sql<null>`null`.as('costs_base_cents'),
        marginBaseCents: showMoney
          ? vehicleFinancials.grossMarginBaseCents
          : sql<null>`null`.as('margin_base_cents'),
      })
      .from(vehicles)
      .leftJoin(vehicleFinancials, eq(vehicleFinancials.vehicleId, vehicles.id))
      .where(and(...where))
      .orderBy(...orderFor(f.sort))
      .limit(f.limit + 1);
  });

  const hasMore = rows.length > f.limit;
  const page = hasMore ? rows.slice(0, f.limit) : rows;
  const now = new Date();

  return ok({
    items: page.map((r) => ({
      id: r.id,
      brand: r.brand,
      model: r.model,
      version: r.version,
      year: r.year,
      km: r.km,
      licensePlate: r.licensePlate,
      status: r.status as VehicleStatus,
      ownership: r.ownership as Ownership,
      listPriceAmountCents: r.listPriceAmountCents,
      listPriceCurrency: r.listPriceCurrency,
      coverUrl: r.coverUrl,
      imageCount: r.imageCount,
      daysInStock: daysInStock(r.acquiredAt, r.soldAt, now),
      daysInStatus: daysInStock(r.statusChangedAt, null, now),
      investedBaseCents:
        r.acquisitionBaseCents === null && r.costsBaseCents === null
          ? null
          : (r.acquisitionBaseCents ?? 0n) + (r.costsBaseCents ?? 0n),
      marginBaseCents: r.marginBaseCents ?? null,
    })),
    nextCursor: hasMore ? encodeCursor(page.at(-1)!, f.sort) : null,
  });
}

function orderFor(sort: VehicleFilters['sort']) {
  switch (sort) {
    case 'oldest':
      return [asc(vehicles.createdAt), asc(vehicles.id)];
    case 'price_asc':
      return [asc(vehicles.listPriceAmountBaseCents), asc(vehicles.id)];
    case 'price_desc':
      return [desc(vehicles.listPriceAmountBaseCents), desc(vehicles.id)];
    case 'stale':
      // Lo que más tiempo lleva parado primero: la pregunta que más importa
      // en un salón es "qué no se está moviendo".
      return [desc(STOCK_AGE_SECONDS), desc(vehicles.id)];
    default:
      return [desc(vehicles.createdAt), desc(vehicles.id)];
  }
}

type CursorRow = {
  id: string;
  createdAt: Date;
  listPriceAmountCents: bigint;
  stockAgeSeconds: number;
};

function encodeCursor(row: CursorRow, sort: VehicleFilters['sort']) {
  const key =
    sort === 'price_asc' || sort === 'price_desc'
      ? row.listPriceAmountCents.toString()
      : sort === 'stale'
        ? String(row.stockAgeSeconds)
        : row.createdAt.toISOString();
  return Buffer.from(`${key}|${row.id}`).toString('base64url');
}

function cursorClause(f: VehicleFilters) {
  if (!f.cursor) return undefined;
  const [key, id] = Buffer.from(f.cursor, 'base64url').toString().split('|');
  if (!key || !id) return undefined;

  // Las fechas viajan como texto con cast explícito: postgres.js no sabe
  // serializar un Date adentro de una comparación de tuplas.
  switch (f.sort) {
    case 'oldest':
      return sql`(${vehicles.createdAt}, ${vehicles.id}) > (${key}::timestamptz, ${id}::uuid)`;
    case 'price_asc':
      return sql`(${vehicles.listPriceAmountBaseCents}, ${vehicles.id}) > (${key}::bigint, ${id}::uuid)`;
    case 'price_desc':
      return sql`(${vehicles.listPriceAmountBaseCents}, ${vehicles.id}) < (${key}::bigint, ${id}::uuid)`;
    case 'stale':
      return sql`(${STOCK_AGE_SECONDS}, ${vehicles.id}) < (${key}::numeric, ${id}::uuid)`;
    default:
      return sql`(${vehicles.createdAt}, ${vehicles.id}) < (${key}::timestamptz, ${id}::uuid)`;
  }
}

export async function getVehicle(ctx: TenantCtx, id: string) {
  const showMoney = canSeeFinancials(ctx.role);

  return withTenant(ctx, async (tx) => {
    const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
    if (!vehicle) return null;

    const [images, consignment, financials, acquisition] = await Promise.all([
      tx
        .select()
        .from(vehicleImages)
        .where(eq(vehicleImages.vehicleId, id))
        .orderBy(desc(vehicleImages.isCover), asc(vehicleImages.position)),
      tx.select().from(consignments).where(eq(consignments.vehicleId, id)).limit(1),
      showMoney
        ? tx.select().from(vehicleFinancials).where(eq(vehicleFinancials.vehicleId, id)).limit(1)
        : Promise.resolve([]),
      showMoney
        ? tx.select().from(vehicleAcquisitions).where(eq(vehicleAcquisitions.vehicleId, id)).limit(1)
        : Promise.resolve([]),
    ]);

    return {
      ...vehicle,
      // El piso de negociación es plata, pero SALES sí lo necesita para vender.
      floorPriceCents: can(ctx.role, 'price:floor:read') ? vehicle.floorPriceCents : null,
      images,
      consignment: consignment[0] ?? null,
      financials: financials[0] ?? null,
      acquisition: acquisition[0] ?? null,
      daysInStock: daysInStock(vehicle.acquiredAt, vehicle.soldAt),
      daysInStatus: daysInStock(vehicle.statusChangedAt, null),
    };
  });
}

export type VehicleDetail = NonNullable<Awaited<ReturnType<typeof getVehicle>>>;

export async function listBrands(ctx: TenantCtx) {
  return withTenant(ctx, (tx) =>
    tx
      .selectDistinct({ brand: vehicles.brand })
      .from(vehicles)
      .orderBy(asc(vehicles.brand))
      .then((rows) => rows.map((r) => r.brand)),
  );
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export async function createVehicle(ctx: TenantCtx, raw: unknown): Promise<Result<{ id: string }>> {
  if (!can(ctx.role, 'vehicle:write')) return fail('FORBIDDEN', 'No podés cargar vehículos.');

  const parsed = vehicleInput.safeParse(raw);
  if (!parsed.success) {
    return fail('VALIDATION', 'Revisá los datos del vehículo.', { issues: parsed.error.issues });
  }
  const input = parsed.data;

  // Cómo entró el vehículo define toda su contabilidad: no se puede cargar
  // una consignación sin contrato ni un auto propio sin precio de compra.
  if (input.ownership === 'CONSIGNMENT' && !input.consignment) {
    return fail('VALIDATION', 'Una consignación necesita los datos del contrato.');
  }
  if (input.ownership === 'OWNED' && !input.acquisition) {
    return fail('VALIDATION', 'Un vehículo propio necesita su precio de adquisición.');
  }

  try {
    const id = await withTenant(ctx, async (tx) => {
      const [created] = await tx
        .insert(vehicles)
        .values({
          agencyId: ctx.agencyId,
          brand: input.brand,
          model: input.model,
          version: input.version ?? null,
          year: input.year,
          km: input.km,
          fuel: input.fuel ?? null,
          transmission: input.transmission ?? null,
          color: input.color ?? null,
          doors: input.doors ?? null,
          licensePlate: input.licensePlate?.toUpperCase() ?? null,
          vin: input.vin?.toUpperCase() ?? null,
          description: input.description ?? null,
          features: input.features,
          ownership: input.ownership,
          status: 'INGRESADO',
          acquiredAt: input.acquiredAt,
          listPriceAmountCents: input.listPrice.amountCents,
          listPriceCurrency: input.listPrice.currency,
          listPriceFxRate: input.listPrice.fxRate,
          listPriceAmountBaseCents: input.listPrice.amountBaseCents,
          floorPriceCents: input.floorPriceCents ?? null,
          slug: await uniqueSlug(tx, ctx, input),
        })
        .returning({ id: vehicles.id });

      const vehicleId = created!.id;

      if (input.ownership === 'CONSIGNMENT' && input.consignment) {
        const c = input.consignment;
        await tx.insert(consignments).values({
          vehicleId,
          agencyId: ctx.agencyId,
          consignorName: c.consignorName,
          consignorDoc: c.consignorDoc ?? null,
          consignorPhone: c.consignorPhone ?? null,
          consignorEmail: c.consignorEmail ?? null,
          agreedFloorAmountCents: c.agreedFloor.amountCents,
          agreedFloorCurrency: c.agreedFloor.currency,
          agreedFloorFxRate: c.agreedFloor.fxRate,
          agreedFloorAmountBaseCents: c.agreedFloor.amountBaseCents,
          commissionType: c.commissionType,
          commissionValue: c.commissionValue,
          contractStartsAt: c.contractStartsAt,
          contractEndsAt: c.contractEndsAt ?? null,
        });
      } else if (input.acquisition) {
        await tx.insert(vehicleAcquisitions).values({
          vehicleId,
          agencyId: ctx.agencyId,
          type: 'PURCHASE',
          valueAmountCents: input.acquisition.amountCents,
          valueCurrency: input.acquisition.currency,
          valueFxRate: input.acquisition.fxRate,
          valueAmountBaseCents: input.acquisition.amountBaseCents,
          occurredAt: input.acquiredAt,
          createdBy: ctx.userId,
        });
      }

      await appendEvent(tx, ctx, {
        vehicleId,
        type: 'VEHICLE_CREATED',
        payload: { ownership: input.ownership, brand: input.brand, model: input.model },
      });

      return vehicleId;
    });

    return ok({ id });
  } catch (err) {
    return mapDbError(err);
  }
}

export const vehiclePatch = vehicleInput
  .omit({ ownership: true, acquisition: true, consignment: true, acquiredAt: true })
  .partial();

export async function updateVehicle(
  ctx: TenantCtx,
  id: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  if (!can(ctx.role, 'vehicle:write')) return fail('FORBIDDEN', 'No podés editar vehículos.');

  const parsed = vehiclePatch.safeParse(raw);
  if (!parsed.success) {
    return fail('VALIDATION', 'Revisá los datos del vehículo.', { issues: parsed.error.issues });
  }
  const patch = parsed.data;

  // Cambiar el precio de lista es una decisión comercial, no una edición más.
  if (patch.listPrice && !can(ctx.role, 'price:list:write')) {
    return fail('FORBIDDEN', 'No podés cambiar el precio de lista.');
  }

  try {
    return await withTenant(ctx, async (tx) => {
      const [before] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
      if (!before) return fail<{ id: string }>('NOT_FOUND', 'El vehículo no existe.');

      const next = {
        brand: patch.brand,
        model: patch.model,
        version: patch.version,
        year: patch.year,
        km: patch.km,
        fuel: patch.fuel,
        transmission: patch.transmission,
        color: patch.color,
        doors: patch.doors,
        licensePlate: patch.licensePlate?.toUpperCase(),
        vin: patch.vin?.toUpperCase(),
        description: patch.description,
        features: patch.features,
        floorPriceCents: patch.floorPriceCents,
        ...(patch.listPrice
          ? {
              listPriceAmountCents: patch.listPrice.amountCents,
              listPriceCurrency: patch.listPrice.currency,
              listPriceFxRate: patch.listPrice.fxRate,
              listPriceAmountBaseCents: patch.listPrice.amountBaseCents,
            }
          : {}),
      };

      await tx.update(vehicles).set(clean(next)).where(eq(vehicles.id, id));

      if (patch.listPrice && patch.listPrice.amountCents !== before.listPriceAmountCents) {
        await appendEvent(tx, ctx, {
          vehicleId: id,
          type: 'PRICE_CHANGED',
          payload: {
            from: before.listPriceAmountCents.toString(),
            to: patch.listPrice.amountCents.toString(),
            currency: patch.listPrice.currency,
          },
        });
      }

      const changes = diffOf(before as Record<string, unknown>, clean(next));
      if (Object.keys(changes).length) {
        await appendEvent(tx, ctx, { vehicleId: id, type: 'VEHICLE_UPDATED', payload: { changes } });
      }

      return ok({ id });
    });
  } catch (err) {
    return mapDbError(err);
  }
}

export async function transitionVehicle(
  ctx: TenantCtx,
  id: string,
  to: VehicleStatus,
  meta?: Record<string, unknown>,
): Promise<Result<{ status: VehicleStatus }>> {
  if (!can(ctx.role, 'vehicle:transition')) {
    return fail('FORBIDDEN', 'No podés cambiar el estado de un vehículo.');
  }
  if (to === 'PUBLICADO' && !can(ctx.role, 'vehicle:publish')) {
    return fail('FORBIDDEN', 'No podés publicar vehículos.');
  }

  return withTenant(ctx, async (tx) => {
    const [v] = await tx
      .select({
        status: vehicles.status,
        ownership: vehicles.ownership,
        listPrice: vehicles.listPriceAmountCents,
        images: sql<number>`(
          select count(*)::int from vehicle_images i where i.vehicle_id = "vehicles"."id"
        )`.as('image_count'),
      })
      .from(vehicles)
      .where(eq(vehicles.id, id))
      .limit(1);

    if (!v) return fail<{ status: VehicleStatus }>('NOT_FOUND', 'El vehículo no existe.');

    const check = assertTransition({
      from: v.status as VehicleStatus,
      to,
      ownership: v.ownership as Ownership,
      hasImages: v.images > 0,
      hasListPrice: v.listPrice > 0n,
    });
    if (!check.ok) return check as Result<{ status: VehicleStatus }>;

    // El estado, el evento y la proyección del catálogo público se mueven
    // juntos. Los triggers de la base actualizan status_changed_at,
    // published_at/sold_at y vehicle_public_view dentro de esta transacción.
    await tx.update(vehicles).set({ status: to }).where(eq(vehicles.id, id));

    await appendEvent(tx, ctx, {
      vehicleId: id,
      type: 'STATUS_CHANGED',
      payload: { from: v.status, to, ...meta },
    });

    if (to === 'PUBLICADO') {
      await appendEvent(tx, ctx, { vehicleId: id, type: 'PUBLISHED', payload: {} });
    }
    if (v.status === 'PUBLICADO' && to !== 'VENDIDO' && to !== 'RESERVADO') {
      await appendEvent(tx, ctx, { vehicleId: id, type: 'UNPUBLISHED', payload: {} });
    }

    return ok({ status: to });
  });
}

export async function addNote(ctx: TenantCtx, id: string, note: string): Promise<Result<true>> {
  const text = note.trim();
  if (!text) return fail('VALIDATION', 'La nota está vacía.');
  if (!can(ctx.role, 'vehicle:write')) return fail('FORBIDDEN', 'No podés agregar notas.');

  return withTenant(ctx, async (tx) => {
    await appendEvent(tx, ctx, { vehicleId: id, type: 'NOTE_ADDED', payload: { note: text } });
    return ok(true as const);
  });
}

// ---------------------------------------------------------------------------

async function uniqueSlug(tx: Tx, ctx: TenantCtx, input: VehicleInput) {
  const stem = slugify(`${input.brand} ${input.model} ${input.version ?? ''} ${input.year}`);
  const [taken] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(vehicles)
    .where(and(eq(vehicles.agencyId, ctx.agencyId), ilike(vehicles.slug, `${stem}%`)));

  return taken && taken.n > 0 ? `${stem}-${taken.n + 1}` : stem;
}

function clean<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function mapDbError(err: unknown): Result<never> {
  const cause = (err as { cause?: { code?: string; constraint_name?: string } }).cause;

  if (cause?.code === '23505') {
    const constraint = cause.constraint_name ?? '';
    if (constraint.includes('plate')) {
      return fail('CONFLICT', 'Ya hay un vehículo con esa patente en la agencia.');
    }
    return fail('CONFLICT', 'Ya existe un vehículo con esos datos.');
  }
  throw err;
}
