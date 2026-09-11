import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { agencies } from './tenancy';
import { vehicles } from './vehicles';
import { fuelType, transmissionType } from './enums';

/**
 * Tabla denormalizada del catálogo público, mantenida por trigger.
 *
 * Una fila por vehículo PUBLICADO con todo lo que el sitio público necesita,
 * imágenes incluidas en JSONB. El listado público es UN SELECT sin joins:
 * es el query más caliente del sistema y no puede depender de 4 tablas.
 *
 * No contiene precio de compra, costos, margen ni piso de negociación.
 * Esos datos no salen del backoffice, ni siquiera por accidente.
 */
export const vehiclePublicView = pgTable(
  'vehicle_public_view',
  {
    vehicleId: uuid()
      .primaryKey()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    agencySlug: text().notNull(),
    slug: text().notNull(),

    brand: text().notNull(),
    model: text().notNull(),
    version: text(),
    year: smallint().notNull(),
    km: integer().notNull(),
    fuel: fuelType(),
    transmission: transmissionType(),
    color: text(),
    doors: smallint(),

    priceCents: bigint({ mode: 'bigint' }).notNull(),
    priceCurrency: char({ length: 3 }).notNull(),

    description: text(),
    features: jsonb().notNull().default(sql`'[]'::jsonb`),
    /** Las primeras imágenes, embebidas: el listado no hace join con vehicle_images. */
    images: jsonb().notNull().default(sql`'[]'::jsonb`),
    imageCount: smallint().notNull().default(0),

    /** Texto normalizado para búsqueda; el índice GIN vive en la migración. */
    searchText: text().notNull().default(''),

    publishedAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vpv_agency_published_idx').on(t.agencyId, t.publishedAt.desc()),
    index('vpv_agency_price_idx').on(t.agencyId, t.priceCents),
    index('vpv_agency_brand_idx').on(t.agencyId, t.brand, t.model),
    index('vpv_agency_year_km_idx').on(t.agencyId, t.year, t.km),
  ],
);
