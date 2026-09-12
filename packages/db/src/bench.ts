import './env';
import { sql } from 'drizzle-orm';
import { dbAdmin } from './client';

/**
 * Genera una agencia con volumen realista para medir contra ella.
 *
 * Un presupuesto de performance corrido sobre el seed —dieciséis vehículos—
 * no prueba nada: Postgres elige scan secuencial porque es lo correcto a esa
 * escala, y cualquier consulta tarda microsegundos. Recién con miles de filas
 * se ve si los índices son los que hacen falta.
 *
 * El truco para cargar rápido es apagar los triggers de proyección durante la
 * carga y reconstruirlas en una pasada al final. Es lo mismo que haría una
 * migración de datos en producción.
 *
 * Crea **muchas** agencias, no una sola grande. La forma real de esta
 * plataforma es una tabla con miles de filas repartidas entre decenas de
 * inquilinos: si todo el volumen fuera de una agencia, el filtro por
 * `agency_id` no sería selectivo, Postgres elegiría scan secuencial con razón,
 * y el índice que mide el presupuesto nunca se usaría.
 */

export const BENCH_PREFIX = 'bench-';

export type BenchScale = {
  agencies: number;
  vehiclesPerAgency: number;
  imagesPerVehicle: number;
  eventsPerVehicle: number;
  costsPerVehicle: number;
  leadsPerAgency: number;
  appointmentsPerAgency: number;
};

export const DEFAULT_SCALE: BenchScale = {
  agencies: 40,
  vehiclesPerAgency: 250,
  imagesPerVehicle: 6,
  eventsPerVehicle: 8,
  costsPerVehicle: 2,
  leadsPerAgency: 100,
  appointmentsPerAgency: 50,
};

const PROJECTION_TRIGGERS: [table: string, trigger: string][] = [
  ['vehicles', 'vehicles_sync_public_view'],
  ['vehicles', 'vehicles_recompute_financials'],
  ['vehicle_images', 'vehicle_images_sync_public_view'],
  ['vehicle_costs', 'vehicle_costs_recompute_financials'],
  ['vehicle_sales', 'vehicle_sales_recompute_financials'],
  ['vehicle_acquisitions', 'vehicle_acquisitions_recompute_financials'],
];

export async function dropBenchData() {
  await dbAdmin.execute(sql`delete from agencies where slug like ${`${BENCH_PREFIX}%`}`);
  await dbAdmin.execute(sql`delete from users where external_id = 'bench_owner'`);
}

/** Devuelve el slug de la agencia contra la que conviene medir. */
export async function createBenchData(scale: BenchScale = DEFAULT_SCALE): Promise<string> {
  await dropBenchData();

  const [user] = await dbAdmin.execute<{ id: string }>(sql`
    insert into users (external_id, email, name)
    values ('bench_owner', 'bench@volumen.test', 'Dueño de volumen')
    on conflict (external_id) do update set email = excluded.email
    returning id
  `);

  await dbAdmin.execute(sql`
    insert into agencies (name, slug, base_currency, status)
    select 'Agencia de volumen ' || i,
           ${BENCH_PREFIX} || lpad(i::text, 3, '0'),
           case when i % 3 = 0 then 'ARS' else 'USD' end,
           'ACTIVE'
    from generate_series(1, ${scale.agencies}) i
  `);

  await dbAdmin.execute(sql`
    insert into agency_settings (agency_id)
    select id from agencies where slug like ${`${BENCH_PREFIX}%`}
  `);

  await dbAdmin.execute(sql`
    insert into memberships (agency_id, user_id, role, status, activated_at)
    select id, ${user!.id}, 'OWNER', 'ACTIVE', now()
    from agencies where slug like ${`${BENCH_PREFIX}%`}
  `);

  await dbAdmin.execute(sql`
    insert into subscriptions (agency_id, plan_code, status, provider, seats_purchased)
    select id, 'base', 'ACTIVE', 'STRIPE', 5
    from agencies where slug like ${`${BENCH_PREFIX}%`}
  `);

  for (const [table, trigger] of PROJECTION_TRIGGERS) {
    await dbAdmin.execute(sql.raw(`alter table ${table} disable trigger ${trigger}`));
  }

  try {
    await loadVehicles(scale);
    await loadImages(scale);
    await loadEvents(scale);
    await loadMoney();
    await loadCommercial(user!.id, scale);
  } finally {
    for (const [table, trigger] of PROJECTION_TRIGGERS) {
      await dbAdmin.execute(sql.raw(`alter table ${table} enable trigger ${trigger}`));
    }
  }

  // Reconstrucción de las proyecciones en una pasada.
  await dbAdmin.execute(sql`
    select recompute_vehicle_financials(v.id) from vehicles v
    join agencies a on a.id = v.agency_id
    where a.slug like ${`${BENCH_PREFIX}%`}
  `);
  await dbAdmin.execute(sql`
    select sync_vehicle_public_view(v.id) from vehicles v
    join agencies a on a.id = v.agency_id
    where a.slug like ${`${BENCH_PREFIX}%`}
  `);

  // Sin estadísticas frescas el planificador decide con números viejos, y el
  // plan que se mide no es el que va a correr.
  await dbAdmin.execute(sql`analyze vehicles, vehicle_images, vehicle_events, vehicle_costs,
    vehicle_sales, vehicle_acquisitions, vehicle_financials, vehicle_public_view,
    leads, appointments`);

  return `${BENCH_PREFIX}001`;
}

/** Todas las agencias del benchmark, para que los loaders trabajen de una vez. */
const benchAgencies = sql`(select id from agencies where slug like ${`${BENCH_PREFIX}%`})`;

const BRANDS = [
  'Toyota', 'Volkswagen', 'Ford', 'Chevrolet', 'Renault', 'Peugeot', 'Fiat', 'Honda',
  'Nissan', 'Jeep', 'Citroën', 'Hyundai',
];

async function loadVehicles(scale: BenchScale) {
  await dbAdmin.execute(sql`
    insert into vehicles (
      agency_id, brand, model, version, year, km, fuel, transmission, color, doors,
      ownership, status, status_changed_at, acquired_at, published_at, sold_at,
      license_plate, list_price_amount_cents, list_price_currency,
      list_price_amount_base_cents, floor_price_cents, description, features, slug, created_at
    )
    select
      a.id,
      (array[${sql.join(BRANDS.map((b) => sql`${b}`), sql`, `)}])[1 + (i % ${BRANDS.length})],
      'Modelo ' || (1 + i % 40),
      'Versión ' || (1 + i % 7),
      2015 + (i % 10),
      10000 + (i * 37) % 180000,
      (array['NAFTA','DIESEL','GNC','HIBRIDO']::fuel_type[])[1 + (i % 4)],
      (array['MANUAL','AUTOMATICA']::transmission_type[])[1 + (i % 2)],
      (array['Blanco','Negro','Gris','Rojo','Azul'])[1 + (i % 5)],
      (array[3,4,5])[1 + (i % 3)],
      case when i % 4 = 0 then 'CONSIGNMENT'::vehicle_ownership else 'OWNED'::vehicle_ownership end,
      (array['PUBLICADO','PUBLICADO','PUBLICADO','VENDIDO','EN_PREPARACION','RESERVADO','PAUSADO']
        ::vehicle_status[])[1 + (i % 7)],
      now() - make_interval(days => i % 120),
      now() - make_interval(days => 5 + i % 300),
      now() - make_interval(days => i % 100),
      case when (1 + (i % 7)) = 4 then now() - make_interval(days => i % 60) else null end,
      'BN' || lpad((i % 1000)::text, 3, '0') || chr(65 + (i % 26)) || chr(65 + ((i / 26) % 26)),
      (1200000 + (i * 911) % 3000000)::bigint,
      'USD',
      (1200000 + (i * 911) % 3000000)::bigint,
      (1100000 + (i * 911) % 2800000)::bigint,
      'Unidad de prueba número ' || i || '. Service al día, papeles en orden.',
      '["Bluetooth","Cámara de retroceso","Control de estabilidad"]'::jsonb,
      a.slug || '-' || i,
      now() - make_interval(days => 5 + i % 300)
    from agencies a
    cross join generate_series(1, ${scale.vehiclesPerAgency}) i
    where a.slug like ${`${BENCH_PREFIX}%`}
  `);
}

async function loadImages(scale: BenchScale) {
  await dbAdmin.execute(sql`
    insert into vehicle_images (
      agency_id, vehicle_id, blob_url, blob_pathname, width, height, bytes, position, is_cover
    )
    select
      v.agency_id, v.id,
      'https://example.test/bench/' || v.id || '-' || n || '.jpg',
      'bench/' || v.id || '/' || n || '.jpg',
      1200, 800, 180000, n - 1, n = 1
    from vehicles v
    cross join generate_series(1, ${scale.imagesPerVehicle}) n
    where v.agency_id in ${benchAgencies}
  `);
}

async function loadEvents(scale: BenchScale) {
  await dbAdmin.execute(sql`
    insert into vehicle_events (agency_id, vehicle_id, type, payload, source, occurred_at)
    select
      v.agency_id, v.id,
      (array['VEHICLE_CREATED','STATUS_CHANGED','PRICE_CHANGED','IMAGES_ADDED',
             'COST_REGISTERED','PUBLISHED','NOTE_ADDED','LEAD_RECEIVED']::event_type[])[n],
      '{}'::jsonb, 'SYSTEM',
      v.acquired_at + make_interval(hours => n * 6)
    from vehicles v
    cross join generate_series(1, ${scale.eventsPerVehicle}) n
    where v.agency_id in ${benchAgencies}
  `);
}

async function loadMoney() {
  await dbAdmin.execute(sql`
    insert into vehicle_acquisitions (
      vehicle_id, agency_id, type, value_amount_cents, value_currency,
      value_amount_base_cents, occurred_at
    )
    select v.id, v.agency_id, 'PURCHASE',
           (v.list_price_amount_cents * 0.85)::bigint, 'USD',
           (v.list_price_amount_cents * 0.85)::bigint, v.acquired_at
    from vehicles v
    where v.agency_id in ${benchAgencies} and v.ownership = 'OWNED'
  `);

  await dbAdmin.execute(sql`
    insert into consignments (
      vehicle_id, agency_id, consignor_name, agreed_floor_amount_cents, agreed_floor_currency,
      agreed_floor_amount_base_cents, commission_type, commission_value, contract_starts_at
    )
    select v.id, v.agency_id, 'Dueño ' || v.slug,
           (v.list_price_amount_cents * 0.9)::bigint, 'USD',
           (v.list_price_amount_cents * 0.9)::bigint, 'PCT', 5, v.acquired_at::date
    from vehicles v
    where v.agency_id in ${benchAgencies} and v.ownership = 'CONSIGNMENT'
  `);

  await dbAdmin.execute(sql`
    insert into vehicle_costs (
      agency_id, vehicle_id, category, description, value_amount_cents, value_currency,
      value_amount_base_cents, occurred_at
    )
    select v.agency_id, v.id,
           (array['MECHANICAL','BODYWORK','DETAILING','PAPERWORK']::cost_category[])[1 + (n % 4)],
           'Gasto ' || n,
           (30000 + n * 7000)::bigint, 'USD', (30000 + n * 7000)::bigint,
           v.acquired_at + make_interval(days => n)
    from vehicles v
    cross join generate_series(1, 2) n
    where v.agency_id in ${benchAgencies}
  `);

  await dbAdmin.execute(sql`
    insert into vehicle_sales (
      vehicle_id, agency_id, value_amount_cents, value_currency,
      value_amount_base_cents, sold_at
    )
    select v.id, v.agency_id,
           (v.list_price_amount_cents * 0.97)::bigint, 'USD',
           (v.list_price_amount_cents * 0.97)::bigint, v.sold_at
    from vehicles v
    where v.agency_id in ${benchAgencies} and v.status = 'VENDIDO' and v.sold_at is not null
  `);
}

async function loadCommercial(userId: string, scale: BenchScale) {
  await dbAdmin.execute(sql`
    insert into leads (agency_id, vehicle_id, name, email, phone, message, source, status, created_at)
    select
      a.id,
      (select v.id from vehicles v where v.agency_id = a.id
        offset (i % ${scale.vehiclesPerAgency}) limit 1),
      'Interesado ' || i,
      'interesado' || i || '@example.test',
      '+54 9 11 ' || lpad((i % 10000)::text, 4, '0'),
      'Consulta de prueba ' || i,
      'PUBLIC_SITE',
      (array['NEW','CONTACTED','QUALIFIED','WON','LOST']::lead_status[])[1 + (i % 5)],
      now() - make_interval(days => i % 90)
    from agencies a
    cross join generate_series(1, ${scale.leadsPerAgency}) i
    where a.slug like ${`${BENCH_PREFIX}%`}
  `);

  await dbAdmin.execute(sql`
    insert into appointments (
      agency_id, vehicle_id, type, status, starts_at, ends_at, assigned_to
    )
    select
      a.id,
      (select v.id from vehicles v where v.agency_id = a.id
        offset (i % ${scale.vehiclesPerAgency}) limit 1),
      (array['VISIT','TEST_DRIVE','DELIVERY','APPRAISAL']::appointment_type[])[1 + (i % 4)],
      (array['SCHEDULED','CONFIRMED','DONE','NO_SHOW']::appointment_status[])[1 + (i % 4)],
      now() - make_interval(days => 45) + make_interval(hours => i),
      now() - make_interval(days => 45) + make_interval(hours => i + 1),
      ${userId}
    from agencies a
    cross join generate_series(1, ${scale.appointmentsPerAgency}) i
    where a.slug like ${`${BENCH_PREFIX}%`}
  `);
}
