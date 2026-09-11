import { relations, sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { pk, timestamps } from './_shared';
import { agencies, users } from './tenancy';
import { vehicles } from './vehicles';
import { appointmentStatus, appointmentType, leadSource, leadStatus } from './enums';

export const leads = pgTable(
  'leads',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    vehicleId: uuid().references(() => vehicles.id, { onDelete: 'set null' }),
    name: text().notNull(),
    email: text(),
    phone: text(),
    message: text(),
    source: leadSource().notNull().default('PUBLIC_SITE'),
    status: leadStatus().notNull().default('NEW'),
    assignedTo: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Anonimizado en lugar de borrado, para no romper el timeline. */
    anonymizedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('leads_agency_status_idx').on(t.agencyId, t.status, t.createdAt.desc()),
    index('leads_agency_assigned_idx').on(t.agencyId, t.assignedTo, t.createdAt.desc()),
    index('leads_vehicle_idx').on(t.agencyId, t.vehicleId),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    vehicleId: uuid().references(() => vehicles.id, { onDelete: 'set null' }),
    leadId: uuid().references(() => leads.id, { onDelete: 'set null' }),
    type: appointmentType().notNull().default('VISIT'),
    status: appointmentStatus().notNull().default('SCHEDULED'),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    assignedTo: uuid().references(() => users.id, { onDelete: 'set null' }),
    notes: text(),
    /** Mapeo al evento remoto cuando se conecte Google Calendar. */
    externalRef: jsonb().notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [
    index('appointments_agency_starts_idx').on(t.agencyId, t.startsAt),
    index('appointments_agency_assignee_idx').on(t.agencyId, t.assignedTo, t.startsAt),
    index('appointments_vehicle_idx').on(t.agencyId, t.vehicleId),
  ],
);

/** Horarios de atención. `userId` null = horario de la agencia entera. */
export const availability = pgTable(
  'availability',
  {
    id: pk(),
    agencyId: uuid()
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    /** 0 = domingo */
    weekday: smallint().notNull(),
    fromTime: time().notNull(),
    toTime: time().notNull(),
    ...timestamps,
  },
  (t) => [
    unique('availability_slot_uq').on(t.agencyId, t.userId, t.weekday, t.fromTime),
    index('availability_agency_idx').on(t.agencyId, t.weekday),
  ],
);

export const leadsRelations = relations(leads, ({ one }) => ({
  vehicle: one(vehicles, { fields: [leads.vehicleId], references: [vehicles.id] }),
  assignee: one(users, { fields: [leads.assignedTo], references: [users.id] }),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  vehicle: one(vehicles, { fields: [appointments.vehicleId], references: [vehicles.id] }),
  lead: one(leads, { fields: [appointments.leadId], references: [leads.id] }),
  assignee: one(users, { fields: [appointments.assignedTo], references: [users.id] }),
}));
