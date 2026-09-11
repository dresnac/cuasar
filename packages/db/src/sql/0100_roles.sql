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
end $$;

grant app_tenant, app_platform to current_user;

grant usage on schema public to app_tenant, app_platform;

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
alter default privileges in schema public
  grant usage on sequences to app_tenant, app_platform;
