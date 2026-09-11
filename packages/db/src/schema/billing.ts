import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { pk, timestamps } from './_shared';
import { agencies } from './tenancy';
import { billingProvider, invoiceStatus, subscriptionStatus } from './enums';

export const plans = pgTable('plans', {
  code: text().primaryKey(),
  name: text().notNull(),
  priceCents: bigint({ mode: 'bigint' }).notNull(),
  currency: char({ length: 3 }).notNull().default('USD'),
  /** Plan base: USD 100/mes con 5 usuarios incluidos. */
  includedSeats: integer().notNull().default(5),
  extraSeatPriceCents: bigint({ mode: 'bigint' }).notNull().default(sql`0`),
  vehicleLimit: integer(),
  features: jsonb().notNull().default(sql`'{}'::jsonb`),
  ...timestamps,
});

/**
 * Proyección del estado en el proveedor, nunca la fuente de verdad:
 * un cron reconcilia contra la API de Stripe / MercadoPago.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    planCode: text()
      .notNull()
      .references(() => plans.code),
    status: subscriptionStatus().notNull().default('TRIALING'),
    provider: billingProvider().notNull(),
    providerCustomerId: text(),
    providerSubscriptionId: text(),
    currentPeriodEnd: timestamp({ withTimezone: true }),
    /** Asientos facturados. El límite efectivo es max(includedSeats, seatsPurchased). */
    seatsPurchased: integer().notNull().default(5),
    cancelAtPeriodEnd: jsonb().notNull().default(sql`'false'::jsonb`),
    gracePeriodEndsAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Una sola suscripción viva por agencia.
    uniqueIndex('subscriptions_active_agency_uq')
      .on(t.agencyId)
      .where(sql`status <> 'CANCELLED'`),
    index('subscriptions_status_idx').on(t.status, t.currentPeriodEnd),
    unique('subscriptions_provider_sub_uq').on(t.provider, t.providerSubscriptionId),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    provider: billingProvider().notNull(),
    providerInvoiceId: text().notNull(),
    amountCents: bigint({ mode: 'bigint' }).notNull(),
    currency: char({ length: 3 }).notNull(),
    status: invoiceStatus().notNull().default('OPEN'),
    issuedAt: timestamp({ withTimezone: true }).notNull(),
    paidAt: timestamp({ withTimezone: true }),
    pdfUrl: text(),
    ...timestamps,
  },
  (t) => [
    unique('invoices_provider_invoice_uq').on(t.provider, t.providerInvoiceId),
    index('invoices_agency_issued_idx').on(t.agencyId, t.issuedAt.desc()),
  ],
);

/**
 * Idempotencia de webhooks. Stripe y MercadoPago reintentan y llegan
 * desordenados: un evento ya visto se descarta por esta clave única.
 */
export const billingEvents = pgTable(
  'billing_events',
  {
    id: pk(),
    agencyId: uuid().references(() => agencies.id, { onDelete: 'set null' }),
    provider: billingProvider().notNull(),
    providerEventId: text().notNull(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
    error: text(),
  },
  (t) => [
    unique('billing_events_provider_event_uq').on(t.provider, t.providerEventId),
    index('billing_events_unprocessed_idx').on(t.processedAt, t.receivedAt),
  ],
);
