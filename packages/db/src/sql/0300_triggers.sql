-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at'
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('drop trigger if exists %I on %I', t || '_touch_updated_at', t);
    execute format(
      'create trigger %I before update on %I
         for each row execute function touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Ciclo de vida del vehículo
-- ---------------------------------------------------------------------------
create or replace function vehicles_track_status() returns trigger as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();

    if new.status = 'PUBLICADO' and new.published_at is null then
      new.published_at := now();
    end if;
    if new.status = 'VENDIDO' and new.sold_at is null then
      new.sold_at := now();
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists vehicles_track_status on vehicles;
create trigger vehicles_track_status before update on vehicles
  for each row execute function vehicles_track_status();

-- ---------------------------------------------------------------------------
-- Proyección contable  (vehicle_financials)
--
-- Se recalcula por trigger en cada costo / venta / adquisición. El dashboard
-- lee de acá: nunca hace SUM() sobre miles de filas en vivo.
-- Todos los montos en la moneda base DE LA AGENCIA.
-- ---------------------------------------------------------------------------
create or replace function recompute_vehicle_financials(v_id uuid) returns void as $$
declare
  v            record;
  acq_cents    bigint := 0;
  cost_cents   bigint := 0;
  sale_cents   bigint;
  comm_cents   bigint := 0;
  margin_cents bigint;
  base         bigint;
  pct          numeric(8,4);
  days         integer;
begin
  select id, agency_id, ownership, acquired_at, sold_at
    into v
  from vehicles where id = v_id;

  if not found then
    delete from vehicle_financials where vehicle_id = v_id;
    return;
  end if;

  -- sum() y no una lectura directa: un SELECT INTO sin filas deja la
  -- variable en NULL, y acá NULL no es cero, es "todavía no hay adquisición".
  select coalesce(sum(value_amount_base_cents), 0) into acq_cents
  from vehicle_acquisitions where vehicle_id = v_id;

  select coalesce(sum(value_amount_base_cents), 0) into cost_cents
  from vehicle_costs where vehicle_id = v_id;

  -- sale_cents SÍ puede quedar NULL a propósito: sin venta no hay margen.
  select value_amount_base_cents into sale_cents
  from vehicle_sales where vehicle_id = v_id;

  if v.ownership = 'CONSIGNMENT' then
    -- El capital de adquisición no es de la agencia: el resultado es la
    -- comisión menos lo que la agencia sí puso de su bolsillo.
    select case
             when c.commission_type = 'PCT'
               then floor(coalesce(sale_cents, 0) * c.commission_value / 100.0)::bigint
             else floor(c.commission_value)::bigint
           end
      into comm_cents
    from consignments c where c.vehicle_id = v_id;

    comm_cents := coalesce(comm_cents, 0);
    acq_cents  := 0;
    margin_cents := case when sale_cents is null then null
                         else comm_cents - cost_cents end;
    base := nullif(sale_cents, 0);
  else
    margin_cents := case when sale_cents is null then null
                         else sale_cents - acq_cents - cost_cents end;
    base := nullif(acq_cents + cost_cents, 0);
  end if;

  pct := case when margin_cents is null or base is null then null
              else round((margin_cents::numeric / base::numeric) * 100, 4) end;

  -- Se congela al vender. Mientras está en stock lo calcula el query en vivo,
  -- porque un valor guardado quedaría viejo todos los días.
  days := case when v.sold_at is null then null
               else greatest(0, (v.sold_at::date - v.acquired_at::date)) end;

  insert into vehicle_financials as f (
    vehicle_id, agency_id, acquisition_base_cents, costs_base_cents,
    sale_base_cents, commission_base_cents, gross_margin_base_cents,
    margin_pct, days_in_stock, recomputed_at
  ) values (
    v_id, v.agency_id, acq_cents, cost_cents,
    sale_cents, comm_cents, margin_cents,
    pct, days, now()
  )
  on conflict (vehicle_id) do update set
    agency_id               = excluded.agency_id,
    acquisition_base_cents  = excluded.acquisition_base_cents,
    costs_base_cents        = excluded.costs_base_cents,
    sale_base_cents         = excluded.sale_base_cents,
    commission_base_cents   = excluded.commission_base_cents,
    gross_margin_base_cents = excluded.gross_margin_base_cents,
    margin_pct              = excluded.margin_pct,
    days_in_stock           = excluded.days_in_stock,
    recomputed_at           = now();
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create or replace function financials_trigger() returns trigger as $$
begin
  perform recompute_vehicle_financials(coalesce(new.vehicle_id, old.vehicle_id));
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

do $$
declare t text;
begin
  foreach t in array array[
    'vehicle_costs', 'vehicle_sales', 'vehicle_acquisitions', 'consignments'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_recompute_financials', t);
    execute format(
      'create trigger %I after insert or update or delete on %I
         for each row execute function financials_trigger()',
      t || '_recompute_financials', t
    );
  end loop;
end $$;

-- Cambiar ownership o vender cambia toda la cuenta del vehículo.
create or replace function vehicles_financials_trigger() returns trigger as $$
begin
  if tg_op = 'INSERT'
     or new.ownership is distinct from old.ownership
     or new.sold_at   is distinct from old.sold_at then
    perform recompute_vehicle_financials(new.id);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists vehicles_recompute_financials on vehicles;
create trigger vehicles_recompute_financials after insert or update on vehicles
  for each row execute function vehicles_financials_trigger();
