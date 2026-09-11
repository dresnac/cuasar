import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { pk, timestamps } from './_shared';
import { agencyStatus, membershipRole, membershipStatus, platformLevel } from './enums';

export const agencies = pgTable(
  'agencies',
  {
    id: pk(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    status: agencyStatus().notNull().default('ACTIVE'),
    timezone: text().notNull().default('America/Argentina/Buenos_Aires'),
    /** Moneda en la que esta agencia lee sus márgenes. Ver `money()` en _shared.ts. */
    baseCurrency: char({ length: 3 }).notNull().default('USD'),
    ...timestamps,
  },
  (t) => [index('agencies_status_idx').on(t.status)],
);

export const agencySettings = pgTable('agency_settings', {
  agencyId: uuid()
    .primaryKey()
    .references(() => agencies.id, { onDelete: 'cascade' }),
  /** logo, colores, tipografía — el sitio público se tematiza con esto */
  branding: jsonb().notNull().default(sql`'{}'::jsonb`),
  contact: jsonb().notNull().default(sql`'{}'::jsonb`),
  social: jsonb().notNull().default(sql`'{}'::jsonb`),
  seo: jsonb().notNull().default(sql`'{}'::jsonb`),
  /** dominio propio verificado; el subdominio <slug>.cuasar.app funciona siempre */
  publicDomain: text().unique(),
  publicDomainVerifiedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

/** Espejo local del proveedor de identidad (Clerk). No guarda credenciales. */
export const users = pgTable('users', {
  id: pk(),
  externalId: text().notNull().unique(),
  email: text().notNull(),
  name: text(),
  avatarUrl: text(),
  ...timestamps,
});

export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole().notNull().default('SALES'),
    status: membershipStatus().notNull().default('INVITED'),
    invitedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('memberships_agency_user_uq').on(t.agencyId, t.userId),
    index('memberships_agency_status_idx').on(t.agencyId, t.status),
    index('memberships_user_idx').on(t.userId),
  ],
);

/**
 * Moderadores de plataforma. Deliberadamente fuera del modelo de tenancy:
 * no tienen agency_id y no pasan por RLS de agencia.
 */
export const platformAdmins = pgTable('platform_admins', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  level: platformLevel().notNull().default('SUPPORT'),
  ...timestamps,
});

/** Append-only. Incluye toda impersonación de un moderador sobre una agencia. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: pk(),
    agencyId: uuid().references(() => agencies.id, { onDelete: 'set null' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    impersonated: boolean().notNull().default(false),
    action: text().notNull(),
    targetType: text(),
    targetId: uuid(),
    payload: jsonb().notNull().default(sql`'{}'::jsonb`),
    ip: inet(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_agency_idx').on(t.agencyId, t.occurredAt.desc()),
    index('audit_log_actor_idx').on(t.actorUserId, t.occurredAt.desc()),
  ],
);

export const agenciesRelations = relations(agencies, ({ one, many }) => ({
  settings: one(agencySettings, { fields: [agencies.id], references: [agencySettings.agencyId] }),
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  agency: one(agencies, { fields: [memberships.agencyId], references: [agencies.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));
