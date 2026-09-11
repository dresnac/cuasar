/*
 * Proyección del catálogo público.
 *
 * Una fila por vehículo PUBLICADO, con las imágenes embebidas, para que el
 * listado del sitio público sea UN SELECT sin joins. Es el query más caliente
 * del sistema y no puede depender de cuatro tablas.
 *
 * No se proyectan precio de compra, costos, margen ni piso de negociación:
 * esos datos no salen del backoffice ni por accidente.
 */

/*
 * Las funciones de proyección van con SECURITY DEFINER y `search_path` fijo.
 *
 * Mantener `vehicle_public_view` y `vehicle_financials` es una invariante
 * interna: quien cambió la fila de origen ya tenía permiso para cambiarla, y
 * no tiene por qué tener además permiso sobre las tablas derivadas. Sin esto,
 * un moderador suspendiendo una agencia —que puede escribir `agencies` pero
 * no el catálogo— hacía fallar el trigger.
 *
 * El `search_path` fijo es obligatorio en una función DEFINER: sin él, quien
 * la invoca puede anteponer un esquema propio y hacer que "vehicles" apunte
 * a una tabla suya.
 */
create or replace function sync_vehicle_public_view(v_id uuid) returns void as $$
declare
  v      record;
  imgs   jsonb;
  n      smallint;
begin
  select
    ve.id, ve.agency_id, ve.slug, ve.status,
    ve.brand, ve.model, ve.version, ve.year, ve.km,
    ve.fuel, ve.transmission, ve.color, ve.doors,
    ve.list_price_amount_cents, ve.list_price_currency,
    ve.description, ve.features, ve.published_at,
    a.slug as agency_slug, a.status as agency_status
  into v
  from vehicles ve
  join agencies a on a.id = ve.agency_id
  where ve.id = v_id;

  -- Despublicado, borrado, o la agencia entera dada de baja: fuera del catálogo.
  if not found or v.status <> 'PUBLICADO' or v.agency_status <> 'ACTIVE' then
    delete from vehicle_public_view where vehicle_id = v_id;
    return;
  end if;

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'url', i.blob_url,
        'width', i.width,
        'height', i.height,
        'blur', i.blur_data_url
      ) order by i.is_cover desc, i.position, i.id
    ) filter (where i.id is not null), '[]'::jsonb),
    count(*)::smallint
  into imgs, n
  from vehicle_images i
  where i.vehicle_id = v_id;

  insert into vehicle_public_view as p (
    vehicle_id, agency_id, agency_slug, slug,
    brand, model, version, year, km, fuel, transmission, color, doors,
    price_cents, price_currency, description, features,
    images, image_count, search_text, published_at, updated_at
  ) values (
    v.id, v.agency_id, v.agency_slug, v.slug,
    v.brand, v.model, v.version, v.year, v.km, v.fuel, v.transmission, v.color, v.doors,
    v.list_price_amount_cents, v.list_price_currency, v.description, v.features,
    -- solo las primeras 8: el listado nunca necesita más
    (select coalesce(jsonb_agg(e), '[]'::jsonb)
       from (select e from jsonb_array_elements(imgs) e limit 8) s),
    coalesce(n, 0),
    lower(concat_ws(' ', v.brand, v.model, v.version, v.year::text, v.color)),
    coalesce(v.published_at, now()), now()
  )
  on conflict (vehicle_id) do update set
    agency_slug    = excluded.agency_slug,
    slug           = excluded.slug,
    brand          = excluded.brand,
    model          = excluded.model,
    version        = excluded.version,
    year           = excluded.year,
    km             = excluded.km,
    fuel           = excluded.fuel,
    transmission   = excluded.transmission,
    color          = excluded.color,
    doors          = excluded.doors,
    price_cents    = excluded.price_cents,
    price_currency = excluded.price_currency,
    description    = excluded.description,
    features       = excluded.features,
    images         = excluded.images,
    image_count    = excluded.image_count,
    search_text    = excluded.search_text,
    published_at   = excluded.published_at,
    updated_at     = now();
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create or replace function vehicles_sync_public_view() returns trigger as $$
begin
  perform sync_vehicle_public_view(coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists vehicles_sync_public_view on vehicles;
create trigger vehicles_sync_public_view after insert or update or delete on vehicles
  for each row execute function vehicles_sync_public_view();

create or replace function images_sync_public_view() returns trigger as $$
begin
  perform sync_vehicle_public_view(coalesce(new.vehicle_id, old.vehicle_id));
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists vehicle_images_sync_public_view on vehicle_images;
create trigger vehicle_images_sync_public_view after insert or update or delete on vehicle_images
  for each row execute function images_sync_public_view();

-- Suspender una agencia despublica su catálogo entero.
create or replace function agencies_sync_public_view() returns trigger as $$
begin
  if new.status is distinct from old.status or new.slug is distinct from old.slug then
    perform sync_vehicle_public_view(id) from vehicles where agency_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists agencies_sync_public_view on agencies;
create trigger agencies_sync_public_view after update on agencies
  for each row execute function agencies_sync_public_view();

-- Búsqueda del catálogo: trigram para coincidencia parcial y tolerante a
-- tipeo ("corola" encuentra "Corolla"), que es como busca la gente.
create index if not exists vpv_search_trgm_idx
  on vehicle_public_view using gin (search_text gin_trgm_ops);
