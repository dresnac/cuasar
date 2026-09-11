import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { pk, timestamps } from './_shared';
import { agencies } from './tenancy';
import { integrationProvider, integrationStatus, outboxStatus } from './enums';

export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    provider: integrationProvider().notNull(),
    status: integrationStatus().notNull().default('DISCONNECTED'),
    /** Cifrado en la aplicación antes de escribir. La DB nunca ve el token en claro. */
    credentials: text(),
    scopes: jsonb().notNull().default(sql`'[]'::jsonb`),
    connectedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    lastError: text(),
    ...timestamps,
  },
  (t) => [unique('integration_connections_agency_provider_uq').on(t.agencyId, t.provider)],
);

/** Mapeo bidireccional entidad local ↔ entidad remota. */
export const integrationLinks = pgTable(
  'integration_links',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    provider: integrationProvider().notNull(),
    localType: text().notNull(),
    localId: uuid().notNull(),
    remoteId: text().notNull(),
    lastSyncedAt: timestamp({ withTimezone: true }),
    syncState: jsonb().notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [
    unique('integration_links_local_uq').on(t.agencyId, t.provider, t.localType, t.localId),
    unique('integration_links_remote_uq').on(t.agencyId, t.provider, t.remoteId),
  ],
);

/**
 * Toda escritura que deba salir al mundo se encola acá dentro de la misma
 * transacción que el cambio de dominio. El dominio no importa ningún SDK
 * de tercero: un worker drena esta tabla y llama al adapter.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    topic: text().notNull(),
    payload: jsonb().notNull(),
    status: outboxStatus().notNull().default('PENDING'),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastError: text(),
    processedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('outbox_drain_idx').on(t.status, t.nextAttemptAt),
    index('outbox_agency_idx').on(t.agencyId, t.createdAt.desc()),
  ],
);
