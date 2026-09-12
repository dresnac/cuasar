/*
 * Contexto de transacción en un solo viaje a la base.
 *
 * Antes `withTenant` mandaba tres sentencias sueltas —dos set_config y un
 * SET LOCAL ROLE— y recién después la consulta: cuatro viajes de ida y vuelta
 * para leer una fila. Con la base a 150 ms de la función, cada operación de
 * dominio se iba a segundos.
 *
 * Meterlas en una función las reduce a un viaje. `SET LOCAL ROLE` dentro de
 * una función sin cláusula SET propia sobrevive hasta el fin de la
 * transacción, que es exactamente lo que queremos.
 *
 * No es SECURITY DEFINER a propósito: quien la llama tiene que poder asumir
 * el rol por sus propios medios. Si algún día un rol acotado pudiera invocarla,
 * bajaría privilegios, nunca los subiría.
 */
create or replace function set_tenant_context(p_agency uuid, p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('app.agency_id', coalesce(p_agency::text, ''), true);
  perform set_config('app.user_id', coalesce(p_user::text, ''), true);
  execute 'set local role app_tenant';
end;
$$;

create or replace function set_public_context(p_agency uuid) returns void
language plpgsql as $$
begin
  perform set_config('app.agency_id', coalesce(p_agency::text, ''), true);
  execute 'set local role app_public';
end;
$$;

create or replace function set_platform_context(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('app.user_id', coalesce(p_user::text, ''), true);
  execute 'set local role app_platform';
end;
$$;
