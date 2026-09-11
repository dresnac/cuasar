import { pgEnum } from 'drizzle-orm/pg-core';

export const agencyStatus = pgEnum('agency_status', ['ACTIVE', 'SUSPENDED', 'CANCELLED']);

export const membershipRole = pgEnum('membership_role', ['OWNER', 'ADMIN', 'SALES', 'VIEWER']);
export const membershipStatus = pgEnum('membership_status', ['INVITED', 'ACTIVE', 'DISABLED']);
export const platformLevel = pgEnum('platform_level', ['SUPPORT', 'ADMIN']);

export const vehicleOwnership = pgEnum('vehicle_ownership', ['OWNED', 'CONSIGNMENT']);
export const vehicleStatus = pgEnum('vehicle_status', [
  'INGRESADO',
  'EN_PREPARACION',
  'PUBLICADO',
  'RESERVADO',
  'VENDIDO',
  'PAUSADO',
  'DEVUELTO',
  'BAJA',
]);

export const fuelType = pgEnum('fuel_type', ['NAFTA', 'DIESEL', 'GNC', 'HIBRIDO', 'ELECTRICO']);
export const transmissionType = pgEnum('transmission_type', ['MANUAL', 'AUTOMATICA']);

export const eventSource = pgEnum('event_source', ['WEB', 'API', 'SYSTEM', 'INTEGRATION']);
export const eventType = pgEnum('event_type', [
  'VEHICLE_CREATED',
  'VEHICLE_UPDATED',
  'STATUS_CHANGED',
  'PRICE_CHANGED',
  'IMAGES_ADDED',
  'IMAGES_REMOVED',
  'COST_REGISTERED',
  'COST_REMOVED',
  'ACQUISITION_REGISTERED',
  'PUBLISHED',
  'UNPUBLISHED',
  'LEAD_RECEIVED',
  'APPOINTMENT_SCHEDULED',
  'SOLD',
  'CONSIGNMENT_SETTLED',
  'NOTE_ADDED',
]);

export const acquisitionType = pgEnum('acquisition_type', ['PURCHASE', 'TRADE_IN', 'CONSIGNMENT']);
export const commissionType = pgEnum('commission_type', ['PCT', 'FIXED']);
export const costCategory = pgEnum('cost_category', [
  'MECHANICAL',
  'BODYWORK',
  'DETAILING',
  'PAPERWORK',
  'TRANSPORT',
  'MARKETING',
  'OTHER',
]);

export const leadSource = pgEnum('lead_source', ['PUBLIC_SITE', 'WHATSAPP', 'MELI', 'PHONE', 'MANUAL']);
export const leadStatus = pgEnum('lead_status', ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST']);

export const appointmentType = pgEnum('appointment_type', [
  'VISIT',
  'TEST_DRIVE',
  'DELIVERY',
  'APPRAISAL',
]);
export const appointmentStatus = pgEnum('appointment_status', [
  'SCHEDULED',
  'CONFIRMED',
  'DONE',
  'NO_SHOW',
  'CANCELLED',
]);

export const billingProvider = pgEnum('billing_provider', ['STRIPE', 'MERCADOPAGO']);
export const subscriptionStatus = pgEnum('subscription_status', [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELLED',
]);
export const invoiceStatus = pgEnum('invoice_status', ['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE']);

export const integrationProvider = pgEnum('integration_provider', ['MELI', 'GOOGLE_CALENDAR']);
export const integrationStatus = pgEnum('integration_status', [
  'DISCONNECTED',
  'CONNECTED',
  'ERROR',
  'EXPIRED',
]);
export const outboxStatus = pgEnum('outbox_status', ['PENDING', 'PROCESSING', 'DONE', 'FAILED']);
