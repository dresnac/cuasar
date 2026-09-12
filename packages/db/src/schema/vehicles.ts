import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { money, pk, timestamps } from './_shared';
import { agencies, users } from './tenancy';
import {
  acquisitionType,
  commissionType,
  costCategory,
  eventSource,
  eventType,
  fuelType,
  transmissionType,
  vehicleOwnership,
  vehicleStatus,
} from './enums';

export const vehicles = pgTable(
  'vehicles',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),

    vin: text(),
    licensePlate: text(),
    brand: text().notNull(),
    model: text().notNull(),
    version: text(),
    year: smallint().notNull(),
    km: integer().notNull().default(0),
    fuel: fuelType(),
    transmission: transmissionType(),
    color: text(),
    doors: smallint(),

    ownership: vehicleOwnership().notNull().default('OWNED'),
    status: vehicleStatus().notNull().default('INGRESADO'),
    /** Para "días en el estado actual". Lo mueve el trigger de transición. */
    statusChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    acquiredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp({ withTimezone: true }),
    soldAt: timestamp({ withTimezone: true }),

    /** Precio de venta publicado. */
    ...money('listPrice'),
    /** Piso de negociación: SALES lo ve, VIEWER no. Nunca sale al sitio público. */
    floorPriceCents: bigint({ mode: 'bigint' }),

    description: text(),
    features: jsonb().notNull().default(sql`'[]'::jsonb`),
    slug: text().notNull(),
    ...timestamps,
  },
  (t) => [
    unique('vehicles_agency_plate_uq').on(t.agencyId, t.licensePlate),
    unique('vehicles_agency_slug_uq').on(t.agencyId, t.slug),
    // agency_id primero en todo índice: cada query real ya filtra por tenant.
    // Este es el orden por defecto del listado de stock, así que es el índice
    // que más se usa. Faltaba, y con volumen real el listado caía a scan
    // secuencial: lo encontró `pnpm db:perf --bench`.
    index('vehicles_agency_created_idx').on(t.agencyId, t.createdAt.desc(), t.id.desc()),
    index('vehicles_agency_status_updated_idx').on(t.agencyId, t.status, t.updatedAt.desc()),
    index('vehicles_agency_ownership_idx').on(t.agencyId, t.ownership, t.status),
    index('vehicles_agency_brand_model_idx').on(t.agencyId, t.brand, t.model),
    index('vehicles_agency_acquired_idx').on(t.agencyId, t.acquiredAt),
  ],
);

export const vehicleImages = pgTable(
  'vehicle_images',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    vehicleId: uuid()
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    /** Vercel Blob. En Postgres solo metadata: el binario nunca toca la DB. */
    blobUrl: text().notNull(),
    blobPathname: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    bytes: integer().notNull(),
    blurDataUrl: text(),
    position: smallint().notNull().default(0),
    isCover: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index('vehicle_images_vehicle_pos_idx').on(t.agencyId, t.vehicleId, t.position)],
);

/**
 * Timeline. APPEND-ONLY: los permisos de DB revocan UPDATE y DELETE.
 * Es la fuente de verdad histórica; `vehicles.status` es solo su proyección.
 */
export const vehicleEvents = pgTable(
  'vehicle_events',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    vehicleId: uuid()
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    type: eventType().notNull(),
    /** Datos personales por referencia, no copiados: el borrado anonimiza la entidad. */
    payload: jsonb().notNull().default(sql`'{}'::jsonb`),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    source: eventSource().notNull().default('WEB'),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vehicle_events_timeline_idx').on(t.agencyId, t.vehicleId, t.occurredAt.desc()),
    index('vehicle_events_agency_type_idx').on(t.agencyId, t.type, t.occurredAt.desc()),
  ],
);

export const consignments = pgTable(
  'consignments',
  {
    vehicleId: uuid()
      .primaryKey()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    consignorName: text().notNull(),
    consignorDoc: text(),
    consignorPhone: text(),
    consignorEmail: text(),
    /** Piso acordado con el dueño: por debajo de esto no se vende. */
    ...money('agreedFloor'),
    commissionType: commissionType().notNull().default('PCT'),
    /** PCT: porcentaje (ej. 5.00). FIXED: monto en centavos de la moneda base. */
    commissionValue: numeric({ precision: 14, scale: 2 }).notNull(),
    contractStartsAt: date().notNull(),
    contractEndsAt: date(),
    settledAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('consignments_agency_idx').on(t.agencyId, t.settledAt)],
);

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  agency: one(agencies, { fields: [vehicles.agencyId], references: [agencies.id] }),
  images: many(vehicleImages),
  events: many(vehicleEvents),
  consignment: one(consignments, {
    fields: [vehicles.id],
    references: [consignments.vehicleId],
  }),
}));

export const vehicleImagesRelations = relations(vehicleImages, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleImages.vehicleId], references: [vehicles.id] }),
}));

export const vehicleEventsRelations = relations(vehicleEvents, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleEvents.vehicleId], references: [vehicles.id] }),
  actor: one(users, { fields: [vehicleEvents.actorUserId], references: [users.id] }),
}));
