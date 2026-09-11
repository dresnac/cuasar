-- Corre ANTES de las migraciones de Drizzle: el esquema usa uuidv7() como default.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

/*
 * UUIDv7 — ordenable en el tiempo.
 * Los primeros 48 bits son el timestamp en ms, así el índice primario
 * mantiene localidad y "lo más reciente primero" no necesita otra columna.
 */
create or replace function uuidv7() returns uuid as $$
declare
  ts_millis bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  raw bytea := uuid_send(gen_random_uuid());
begin
  -- 48 bits de timestamp big-endian en los primeros 6 bytes
  raw := overlay(raw placing substring(int8send(ts_millis) from 3 for 6) from 1 for 6);
  -- version = 7 (nibble alto del byte 6)
  raw := set_byte(raw, 6, (get_byte(raw, 6) & 15) | 112);
  -- variant RFC 4122 = 0b10 (dos bits altos del byte 8)
  raw := set_byte(raw, 8, (get_byte(raw, 8) & 63) | 128);
  return encode(raw, 'hex')::uuid;
end;
$$ language plpgsql volatile;

/*
 * Contexto de tenant de la transacción en curso.
 * Si no está seteado devuelve NULL y las políticas RLS fallan cerradas:
 * sin contexto no se ve nada, que es exactamente lo que queremos.
 */
create or replace function current_agency_id() returns uuid as $$
  select nullif(current_setting('app.agency_id', true), '')::uuid;
$$ language sql stable;

create or replace function current_actor_id() returns uuid as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$ language sql stable;
