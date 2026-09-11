import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { money, pk, timestamps } from './_shared';
import { agencies, users } from './tenancy';
import { vehicles } from './vehicles';
import { acquisitionType, costCategory } from './enums';

/**
 * Cómo entró el vehículo. En CONSIGNMENT el monto es informativo
 * (el capital no es de la agencia) y no pesa en el margen.
 */
export const vehicleAcquisitions = pgTable(
  'vehicle_acquisitions',
  {
    vehicleId: uuid()
      .primaryKey()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    type: acquisitionType().notNull(),
    ...money('value'),
    counterparty: text(),
    notes: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('vehicle_acquisitions_agency_idx').on(t.agencyId, t.occurredAt)],
);

export const vehicleCosts = pgTable(
  'vehicle_costs',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    vehicleId: uuid()
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    category: costCategory().notNull(),
    description: text(),
    ...money('value'),
    supplier: text(),
    invoiceRef: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('vehicle_costs_vehicle_idx').on(t.agencyId, t.vehicleId),
    index('vehicle_costs_agency_occurred_idx').on(t.agencyId, t.occurredAt),
    index('vehicle_costs_category_idx').on(t.agencyId, t.category, t.occurredAt),
  ],
);

export const vehicleSales = pgTable(
  'vehicle_sales',
  {
    vehicleId: uuid()
      .primaryKey()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    ...money('value'),
    buyer: jsonb().notNull().default(sql`'{}'::jsonb`),
    paymentMethod: text(),
    salespersonUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    soldAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('vehicle_sales_agency_sold_idx').on(t.agencyId, t.soldAt.desc()),
    index('vehicle_sales_salesperson_idx').on(t.agencyId, t.salespersonUserId, t.soldAt.desc()),
  ],
);

/**
 * Proyección contable por unidad, mantenida por trigger en cada costo/venta.
 * El dashboard lee de acá: no hace SUM() sobre miles de filas en vivo.
 * Todos los montos en la moneda base de la agencia.
 */
export const vehicleFinancials = pgTable(
  'vehicle_financials',
  {
    vehicleId: uuid()
      .primaryKey()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    acquisitionBaseCents: bigint({ mode: 'bigint' }).notNull().default(sql`0`),
    costsBaseCents: bigint({ mode: 'bigint' }).notNull().default(sql`0`),
    saleBaseCents: bigint({ mode: 'bigint' }),
    commissionBaseCents: bigint({ mode: 'bigint' }).notNull().default(sql`0`),
    /** OWNED: venta − adquisición − costos.  CONSIGNMENT: comisión − costos. */
    grossMarginBaseCents: bigint({ mode: 'bigint' }),
    marginPct: numeric({ precision: 8, scale: 4 }),
    /** Congelado al vender; mientras está en stock lo calcula la vista. */
    daysInStock: integer(),
    recomputedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vehicle_financials_agency_idx').on(t.agencyId),
    index('vehicle_financials_margin_idx').on(t.agencyId, t.grossMarginBaseCents),
  ],
);

export const vehicleCostsRelations = relations(vehicleCosts, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleCosts.vehicleId], references: [vehicles.id] }),
}));

export const vehicleFinancialsRelations = relations(vehicleFinancials, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleFinancials.vehicleId], references: [vehicles.id] }),
}));
