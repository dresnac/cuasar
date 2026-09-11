CREATE TYPE "public"."acquisition_type" AS ENUM('PURCHASE', 'TRADE_IN', 'CONSIGNMENT');--> statement-breakpoint
CREATE TYPE "public"."agency_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('SCHEDULED', 'CONFIRMED', 'DONE', 'NO_SHOW', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."appointment_type" AS ENUM('VISIT', 'TEST_DRIVE', 'DELIVERY', 'APPRAISAL');--> statement-breakpoint
CREATE TYPE "public"."billing_provider" AS ENUM('STRIPE', 'MERCADOPAGO');--> statement-breakpoint
CREATE TYPE "public"."commission_type" AS ENUM('PCT', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."cost_category" AS ENUM('MECHANICAL', 'BODYWORK', 'DETAILING', 'PAPERWORK', 'TRANSPORT', 'MARKETING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('WEB', 'API', 'SYSTEM', 'INTEGRATION');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('VEHICLE_CREATED', 'VEHICLE_UPDATED', 'STATUS_CHANGED', 'PRICE_CHANGED', 'IMAGES_ADDED', 'IMAGES_REMOVED', 'COST_REGISTERED', 'COST_REMOVED', 'ACQUISITION_REGISTERED', 'PUBLISHED', 'UNPUBLISHED', 'LEAD_RECEIVED', 'APPOINTMENT_SCHEDULED', 'SOLD', 'CONSIGNMENT_SETTLED', 'NOTE_ADDED');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('NAFTA', 'DIESEL', 'GNC', 'HIBRIDO', 'ELECTRICO');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('MELI', 'GOOGLE_CALENDAR');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('DISCONNECTED', 'CONNECTED', 'ERROR', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('PUBLIC_SITE', 'WHATSAPP', 'MELI', 'PHONE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('OWNER', 'ADMIN', 'SALES', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('INVITED', 'ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('PENDING', 'PROCESSING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."platform_level" AS ENUM('SUPPORT', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."transmission_type" AS ENUM('MANUAL', 'AUTOMATICA');--> statement-breakpoint
CREATE TYPE "public"."vehicle_ownership" AS ENUM('OWNED', 'CONSIGNMENT');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('INGRESADO', 'EN_PREPARACION', 'PUBLICADO', 'RESERVADO', 'VENDIDO', 'PAUSADO', 'DEVUELTO', 'BAJA');--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "agency_status" DEFAULT 'ACTIVE' NOT NULL,
	"timezone" text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	"base_currency" char(3) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agencies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agency_settings" (
	"agency_id" uuid PRIMARY KEY NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"social" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"public_domain" text,
	"public_domain_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_settings_publicDomain_unique" UNIQUE("public_domain")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid,
	"actor_user_id" uuid,
	"impersonated" boolean DEFAULT false NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" "inet",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'SALES' NOT NULL,
	"status" "membership_status" DEFAULT 'INVITED' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_agency_user_uq" UNIQUE("agency_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"level" "platform_level" DEFAULT 'SUPPORT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"external_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_externalId_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "consignments" (
	"vehicle_id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"consignor_name" text NOT NULL,
	"consignor_doc" text,
	"consignor_phone" text,
	"consignor_email" text,
	"agreed_floor_amount_cents" bigint NOT NULL,
	"agreed_floor_currency" char(3) NOT NULL,
	"agreed_floor_fx_rate" numeric(20, 10) DEFAULT '1' NOT NULL,
	"agreed_floor_amount_base_cents" bigint NOT NULL,
	"commission_type" "commission_type" DEFAULT 'PCT' NOT NULL,
	"commission_value" numeric(14, 2) NOT NULL,
	"contract_starts_at" date NOT NULL,
	"contract_ends_at" date,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"type" "event_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"source" "event_source" DEFAULT 'WEB' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_images" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"blob_url" text NOT NULL,
	"blob_pathname" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"blur_data_url" text,
	"position" smallint DEFAULT 0 NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"vin" text,
	"license_plate" text,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"version" text,
	"year" smallint NOT NULL,
	"km" integer DEFAULT 0 NOT NULL,
	"fuel" "fuel_type",
	"transmission" "transmission_type",
	"color" text,
	"doors" smallint,
	"ownership" "vehicle_ownership" DEFAULT 'OWNED' NOT NULL,
	"status" "vehicle_status" DEFAULT 'INGRESADO' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"sold_at" timestamp with time zone,
	"list_price_amount_cents" bigint NOT NULL,
	"list_price_currency" char(3) NOT NULL,
	"list_price_fx_rate" numeric(20, 10) DEFAULT '1' NOT NULL,
	"list_price_amount_base_cents" bigint NOT NULL,
	"floor_price_cents" bigint,
	"description" text,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_agency_plate_uq" UNIQUE("agency_id","license_plate"),
	CONSTRAINT "vehicles_agency_slug_uq" UNIQUE("agency_id","slug")
);
--> statement-breakpoint
CREATE TABLE "vehicle_acquisitions" (
	"vehicle_id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"type" "acquisition_type" NOT NULL,
	"value_amount_cents" bigint NOT NULL,
	"value_currency" char(3) NOT NULL,
	"value_fx_rate" numeric(20, 10) DEFAULT '1' NOT NULL,
	"value_amount_base_cents" bigint NOT NULL,
	"counterparty" text,
	"notes" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_costs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"category" "cost_category" NOT NULL,
	"description" text,
	"value_amount_cents" bigint NOT NULL,
	"value_currency" char(3) NOT NULL,
	"value_fx_rate" numeric(20, 10) DEFAULT '1' NOT NULL,
	"value_amount_base_cents" bigint NOT NULL,
	"supplier" text,
	"invoice_ref" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_financials" (
	"vehicle_id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"acquisition_base_cents" bigint DEFAULT 0 NOT NULL,
	"costs_base_cents" bigint DEFAULT 0 NOT NULL,
	"sale_base_cents" bigint,
	"commission_base_cents" bigint DEFAULT 0 NOT NULL,
	"gross_margin_base_cents" bigint,
	"margin_pct" numeric(8, 4),
	"days_in_stock" integer,
	"recomputed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_sales" (
	"vehicle_id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"value_amount_cents" bigint NOT NULL,
	"value_currency" char(3) NOT NULL,
	"value_fx_rate" numeric(20, 10) DEFAULT '1' NOT NULL,
	"value_amount_base_cents" bigint NOT NULL,
	"buyer" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_method" text,
	"salesperson_user_id" uuid,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"lead_id" uuid,
	"type" "appointment_type" DEFAULT 'VISIT' NOT NULL,
	"status" "appointment_status" DEFAULT 'SCHEDULED' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"assigned_to" uuid,
	"notes" text,
	"external_ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"user_id" uuid,
	"weekday" smallint NOT NULL,
	"from_time" time NOT NULL,
	"to_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_slot_uq" UNIQUE("agency_id","user_id","weekday","from_time")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"message" text,
	"source" "lead_source" DEFAULT 'PUBLIC_SITE' NOT NULL,
	"status" "lead_status" DEFAULT 'NEW' NOT NULL,
	"assigned_to" uuid,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid,
	"provider" "billing_provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "billing_events_provider_event_uq" UNIQUE("provider","provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_invoice_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "invoice_status" DEFAULT 'OPEN' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"pdf_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_provider_invoice_uq" UNIQUE("provider","provider_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"included_seats" integer DEFAULT 5 NOT NULL,
	"extra_seat_price_cents" bigint DEFAULT 0 NOT NULL,
	"vehicle_limit" integer,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"status" "subscription_status" DEFAULT 'TRIALING' NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"current_period_end" timestamp with time zone,
	"seats_purchased" integer DEFAULT 5 NOT NULL,
	"cancel_at_period_end" jsonb DEFAULT 'false'::jsonb NOT NULL,
	"grace_period_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_provider_sub_uq" UNIQUE("provider","provider_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"status" "integration_status" DEFAULT 'DISCONNECTED' NOT NULL,
	"credentials" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"connected_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_agency_provider_uq" UNIQUE("agency_id","provider")
);
--> statement-breakpoint
CREATE TABLE "integration_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"local_type" text NOT NULL,
	"local_id" uuid NOT NULL,
	"remote_id" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_links_local_uq" UNIQUE("agency_id","provider","local_type","local_id"),
	CONSTRAINT "integration_links_remote_uq" UNIQUE("agency_id","provider","remote_id")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agency_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_public_view" (
	"vehicle_id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"agency_slug" text NOT NULL,
	"slug" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"version" text,
	"year" smallint NOT NULL,
	"km" integer NOT NULL,
	"fuel" "fuel_type",
	"transmission" "transmission_type",
	"color" text,
	"doors" smallint,
	"price_cents" bigint NOT NULL,
	"price_currency" char(3) NOT NULL,
	"description" text,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_count" smallint DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agency_settings" ADD CONSTRAINT "agency_settings_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignments" ADD CONSTRAINT "consignments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignments" ADD CONSTRAINT "consignments_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_events" ADD CONSTRAINT "vehicle_events_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_events" ADD CONSTRAINT "vehicle_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_events" ADD CONSTRAINT "vehicle_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_acquisitions" ADD CONSTRAINT "vehicle_acquisitions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_acquisitions" ADD CONSTRAINT "vehicle_acquisitions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_acquisitions" ADD CONSTRAINT "vehicle_acquisitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_costs" ADD CONSTRAINT "vehicle_costs_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_costs" ADD CONSTRAINT "vehicle_costs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_costs" ADD CONSTRAINT "vehicle_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_financials" ADD CONSTRAINT "vehicle_financials_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_financials" ADD CONSTRAINT "vehicle_financials_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_sales" ADD CONSTRAINT "vehicle_sales_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_sales" ADD CONSTRAINT "vehicle_sales_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_sales" ADD CONSTRAINT "vehicle_sales_salesperson_user_id_users_id_fk" FOREIGN KEY ("salesperson_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_public_view" ADD CONSTRAINT "vehicle_public_view_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_public_view" ADD CONSTRAINT "vehicle_public_view_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agencies_status_idx" ON "agencies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_log_agency_idx" ON "audit_log" USING btree ("agency_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memberships_agency_status_idx" ON "memberships" USING btree ("agency_id","status");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "consignments_agency_idx" ON "consignments" USING btree ("agency_id","settled_at");--> statement-breakpoint
CREATE INDEX "vehicle_events_timeline_idx" ON "vehicle_events" USING btree ("agency_id","vehicle_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vehicle_events_agency_type_idx" ON "vehicle_events" USING btree ("agency_id","type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vehicle_images_vehicle_pos_idx" ON "vehicle_images" USING btree ("agency_id","vehicle_id","position");--> statement-breakpoint
CREATE INDEX "vehicles_agency_status_updated_idx" ON "vehicles" USING btree ("agency_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vehicles_agency_ownership_idx" ON "vehicles" USING btree ("agency_id","ownership","status");--> statement-breakpoint
CREATE INDEX "vehicles_agency_brand_model_idx" ON "vehicles" USING btree ("agency_id","brand","model");--> statement-breakpoint
CREATE INDEX "vehicles_agency_acquired_idx" ON "vehicles" USING btree ("agency_id","acquired_at");--> statement-breakpoint
CREATE INDEX "vehicle_acquisitions_agency_idx" ON "vehicle_acquisitions" USING btree ("agency_id","occurred_at");--> statement-breakpoint
CREATE INDEX "vehicle_costs_vehicle_idx" ON "vehicle_costs" USING btree ("agency_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_costs_agency_occurred_idx" ON "vehicle_costs" USING btree ("agency_id","occurred_at");--> statement-breakpoint
CREATE INDEX "vehicle_costs_category_idx" ON "vehicle_costs" USING btree ("agency_id","category","occurred_at");--> statement-breakpoint
CREATE INDEX "vehicle_financials_agency_idx" ON "vehicle_financials" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "vehicle_financials_margin_idx" ON "vehicle_financials" USING btree ("agency_id","gross_margin_base_cents");--> statement-breakpoint
CREATE INDEX "vehicle_sales_agency_sold_idx" ON "vehicle_sales" USING btree ("agency_id","sold_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vehicle_sales_salesperson_idx" ON "vehicle_sales" USING btree ("agency_id","salesperson_user_id","sold_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "appointments_agency_starts_idx" ON "appointments" USING btree ("agency_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_agency_assignee_idx" ON "appointments" USING btree ("agency_id","assigned_to","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_vehicle_idx" ON "appointments" USING btree ("agency_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "availability_agency_idx" ON "availability" USING btree ("agency_id","weekday");--> statement-breakpoint
CREATE INDEX "leads_agency_status_idx" ON "leads" USING btree ("agency_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_agency_assigned_idx" ON "leads" USING btree ("agency_id","assigned_to","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_vehicle_idx" ON "leads" USING btree ("agency_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "billing_events_unprocessed_idx" ON "billing_events" USING btree ("processed_at","received_at");--> statement-breakpoint
CREATE INDEX "invoices_agency_issued_idx" ON "invoices" USING btree ("agency_id","issued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_active_agency_uq" ON "subscriptions" USING btree ("agency_id") WHERE status <> 'CANCELLED';--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE INDEX "outbox_drain_idx" ON "outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_agency_idx" ON "outbox" USING btree ("agency_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vpv_agency_published_idx" ON "vehicle_public_view" USING btree ("agency_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vpv_agency_price_idx" ON "vehicle_public_view" USING btree ("agency_id","price_cents");--> statement-breakpoint
CREATE INDEX "vpv_agency_brand_idx" ON "vehicle_public_view" USING btree ("agency_id","brand","model");--> statement-breakpoint
CREATE INDEX "vpv_agency_year_km_idx" ON "vehicle_public_view" USING btree ("agency_id","year","km");