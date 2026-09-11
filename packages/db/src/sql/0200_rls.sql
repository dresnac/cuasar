/*
 * Aislamiento entre agencias. Este archivo es el muro del sistema:
 * aunque un query olvide el WHERE agency_id, Postgres no devuelve filas
 * de otro tenant. Los tests de packages/db/tests/isolation.test.ts
 * intentan explícitamente cruzarlo y deben fallar.
 */

do $$
declare
  t text;
  tenant_tables text[] := array[
    'agencies', 'agency_settings', 'memberships',
    'vehicles', 'vehicle_images', 'vehicle_events', 'consignments',
    'vehicle_acquisitions', 'vehicle_costs', 'vehicle_sales', 'vehicle_financials',
    'vehicle_public_view',
    'leads', 'appointments', 'availability',
    'subscriptions', 'invoices',
    'integration_connections', 'integration_links', 'outbox',
    'audit_log'
  ];
  key_column text;
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);

    -- `agencies` se filtra por su propia PK; el resto por agency_id.
    key_column := case when t = 'agencies' then 'id' else 'agency_id' end;

    execute format('drop policy if exists %I on %I', t || '_tenant_isolation', t);
    execute format(
      'create policy %I on %I to app_tenant
         using (%I = current_agency_id())
         with check (%I = current_agency_id())',
      t || '_tenant_isolation', t, key_column, key_column
    );
  end loop;
end $$;

-- `users` es global; un tenant solo ve a quien comparte membresía con él.
alter table users enable row level security;
drop policy if exists users_tenant_visibility on users;
create policy users_tenant_visibility on users to app_tenant
  using (
    exists (
      select 1 from memberships m
      where m.user_id = users.id and m.agency_id = current_agency_id()
    )
  )
  with check (
    exists (
      select 1 from memberships m
      where m.user_id = users.id and m.agency_id = current_agency_id()
    )
  );

/*
 * El sitio público. Mismo contexto de agencia que el backoffice, pero con
 * un rol que casi no tiene privilegios: si algún día una consulta suya
 * apuntara a la tabla equivocada, el GRANT la frena antes que la política.
 */
drop policy if exists vehicle_public_view_public_read on vehicle_public_view;
create policy vehicle_public_view_public_read on vehicle_public_view to app_public
  using (agency_id = current_agency_id());

drop policy if exists agencies_public_read on agencies;
create policy agencies_public_read on agencies to app_public
  using (id = current_agency_id() and status = 'ACTIVE');

drop policy if exists agency_settings_public_read on agency_settings;
create policy agency_settings_public_read on agency_settings to app_public
  using (agency_id = current_agency_id());

-- Solo puede dejar consultas, nunca leerlas: un formulario público que
-- pudiera releer la bandeja sería una filtración de datos de contacto.
drop policy if exists leads_public_insert on leads;
create policy leads_public_insert on leads to app_public
  with check (agency_id = current_agency_id() and source = 'PUBLIC_SITE');

drop policy if exists vehicle_events_public_insert on vehicle_events;
create policy vehicle_events_public_insert on vehicle_events to app_public
  with check (agency_id = current_agency_id() and source = 'WEB');

drop policy if exists outbox_public_insert on outbox;
create policy outbox_public_insert on outbox to app_public
  with check (agency_id = current_agency_id());

-- `plans` es catálogo público de la plataforma: lectura para todos.
alter table plans enable row level security;
drop policy if exists plans_readable on plans;
create policy plans_readable on plans to app_tenant, app_platform using (true);

-- El rol de plataforma no pasa por contexto de agencia: ve todo lo que
-- sus GRANTs le permiten (cuentas y facturación, no datos operativos).
do $$
declare
  t text;
begin
  foreach t in array array[
    'agencies', 'agency_settings', 'memberships',
    'subscriptions', 'invoices', 'audit_log'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_platform_access', t);
    execute format(
      'create policy %I on %I to app_platform using (true) with check (true)',
      t || '_platform_access', t
    );
  end loop;
end $$;

alter table users enable row level security;
drop policy if exists users_platform_access on users;
create policy users_platform_access on users to app_platform using (true) with check (true);

alter table vehicles enable row level security;
drop policy if exists vehicles_platform_metrics on vehicles;
-- Solo para métricas agregadas; los GRANTs por columna (0100_roles.sql)
-- ya impiden leer precios, descripción o datos de contacto.
create policy vehicles_platform_metrics on vehicles to app_platform using (true);

alter table billing_events enable row level security;
drop policy if exists billing_events_platform on billing_events;
create policy billing_events_platform on billing_events to app_platform using (true);
