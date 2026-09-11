/*
 * Dos roles de aplicación, sin login propio: la app se conecta con el rol
 * dueño y hace `SET LOCAL ROLE` dentro de cada transacción. Una sola
 * connection string, pero el query corre con privilegios acotados y RLS
 * activo — el dueño de las tablas bypassea RLS, estos roles no.
 */

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_tenant') then
    create role app_tenant nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_platform') then
    create role app_platform nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_public') then
    create role app_public nologin;
  end if;
end $$;

grant app_tenant, app_platform, app_public to current_user;

grant usage on schema public to app_tenant, app_platform, app_public;

-- Tenant: lectura/escritura sobre su propia agencia (lo delimita RLS).
grant select, insert, update, delete on all tables in schema public to app_tenant;
grant usage on all sequences in schema public to app_tenant;

-- Append-only: el timeline y la auditoría no se editan ni se borran.
-- Se resuelve con privilegios, no con un trigger, para que el borrado en
-- cascada de una agencia (retención de 90 días) siga funcionando.
revoke update, delete on vehicle_events from app_tenant;
revoke update, delete on audit_log from app_tenant;

-- El tenant no toca su propia facturación: eso lo escriben los webhooks.
revoke insert, update, delete on subscriptions, invoices, billing_events, plans from app_tenant;

-- Plataforma: corre fuera del contexto de agencia. Lee agregados y
-- administra cuentas; no tiene acceso operativo a los datos de la agencia.
grant select on
  agencies, agency_settings, memberships, users, platform_admins,
  plans, subscriptions, invoices, billing_events, audit_log
to app_platform;
grant select (id, agency_id, status, ownership, acquired_at, sold_at, created_at)
  on vehicles to app_platform;
grant insert, update on agencies, agency_settings, plans, subscriptions to app_platform;
grant insert on audit_log to app_platform;
grant usage on all sequences in schema public to app_platform;

-- Que lo anterior también valga para lo que se cree después.
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_tenant;
-- El sitio público mira a internet: se le da exactamente lo que necesita
-- para mostrar un catálogo y recibir una consulta, y nada más. No puede
-- leer `vehicles` (donde vive el precio de compra), ni releer los leads que
-- él mismo dejó, ni tocar una fila existente.
grant select on vehicle_public_view, agencies, agency_settings to app_public;
grant insert on leads to app_public;
grant insert on vehicle_events to app_public;
grant usage on all sequences in schema public to app_public;

alter default privileges in schema public
  grant usage on sequences to app_tenant, app_platform, app_public;
