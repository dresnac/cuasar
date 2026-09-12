import './env';
import { sql, type SQL } from 'drizzle-orm';
import { dbAdmin, pgClient, withPublicAgency, withTenant, type Tx } from './client';
import { createBenchData, dropBenchData } from './bench';

/**
 * Presupuesto de performance de las consultas calientes.
 *
 *   pnpm db:perf
 *
 * No mide el navegador: mide la base, que es donde una plataforma como esta
 * se degrada primero y en silencio. Cada consulta declara su presupuesto y si
 * alguna se pasa, el comando falla. La idea es que una regresión —un índice
 * que se cayó, un join que alguien agregó, una subconsulta que dejó de usar
 * el índice— aparezca acá y no en producción un sábado.
 *
 * También verifica que no haya scans secuenciales sobre las tablas grandes:
 * el tiempo solo no alcanza, porque un scan de una tabla chica es rápido.
 *
 * Por eso corre con `--bench` sobre una agencia generada con volumen real
 * (miles de vehículos) y no sobre el seed. Sobre dieciséis filas Postgres
 * elige scan secuencial porque es lo correcto, y la medición no dice nada.
 */

type Check = {
  label: string;
  budgetMs: number;
  scope: 'tenant' | 'public';
  query: SQL;
  /** Tablas que NO deberían leerse secuencialmente, por más chico que esté el seed. */
  mustUseIndexOn?: string[];
};

type Result = {
  label: string;
  ms: number;
  budgetMs: number;
  scans: string[];
  seqScans: string[];
  ok: boolean;
};

async function main() {
  const useBench = process.argv.includes('--bench');
  const keep = process.argv.includes('--keep');

  let slug = 'del-sur';
  if (useBench) {
    console.log('→ generando volumen: decenas de agencias con miles de unidades');
    slug = await createBenchData();
  }

  const [agency] = await dbAdmin.execute<{ id: string }>(
    sql`select id from agencies where slug = ${slug} limit 1`,
  );
  if (!agency) throw new Error(`No existe la agencia ${slug}. Corré pnpm db:seed.`);

  const [member] = await dbAdmin.execute<{ user_id: string }>(
    sql`select user_id from memberships where agency_id = ${agency.id} and role = 'OWNER' limit 1`,
  );

  const ctx = { agencyId: agency.id, userId: member!.user_id, role: 'OWNER' as const };

  const [size] = await dbAdmin.execute<Record<string, unknown>>(sql`
    select
      (select count(*)::int from vehicles where agency_id = ${agency.id})       as vehiculos,
      (select count(*)::int from vehicle_public_view where agency_id = ${agency.id}) as publicados,
      (select count(*)::int from vehicle_images where agency_id = ${agency.id}) as fotos,
      (select count(*)::int from vehicle_events where agency_id = ${agency.id}) as eventos,
      (select count(*)::int from leads where agency_id = ${agency.id})          as consultas
  `);
  console.log(`\nMidiendo sobre "${slug}":`, size);

  const results: Result[] = [];
  for (const check of checks()) {
    results.push(await measure(check, ctx));
  }

  if (useBench && !keep) await dropBenchData();

  console.table(
    results.map((r) => ({
      consulta: r.label,
      ms: r.ms.toFixed(2),
      presupuesto: `${r.budgetMs} ms`,
      'seq scans': r.seqScans.length ? r.seqScans.join(', ') : '—',
      estado: r.ok ? 'ok' : 'SE PASÓ',
    })),
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    console.log('\n✓ todas las consultas calientes dentro de presupuesto');
    if (!useBench) {
      console.log('  (sobre el seed. Para que la medición signifique algo: pnpm db:perf --bench)');
    }
    return;
  }

  console.error('\n✗ fuera de presupuesto:');
  for (const r of failed) {
    console.error(`  ${r.label}: ${r.ms.toFixed(2)} ms (presupuesto ${r.budgetMs} ms)`);
    if (r.seqScans.length) console.error(`    scan secuencial en ${r.seqScans.join(', ')}`);
    for (const scan of r.scans) console.error(`    ${scan}`);
  }
  process.exitCode = 1;
}

function checks(): Check[] {
  return [
    {
      // El query más caliente del sistema: es lo que ve cualquiera que entre
      // al sitio de una agencia. Un solo SELECT, sin joins, con las fotos ya
      // embebidas en la proyección.
      label: 'catálogo público · listado',
      budgetMs: 25,
      scope: 'public',
      mustUseIndexOn: ['vehicle_public_view'],
      query: sql`
        select * from vehicle_public_view
        where agency_id = current_agency_id()
        order by published_at desc limit 12
      `,
    },
    {
      label: 'catálogo público · filtrado por marca y precio',
      budgetMs: 25,
      scope: 'public',
      mustUseIndexOn: ['vehicle_public_view'],
      query: sql`
        select * from vehicle_public_view
        where agency_id = current_agency_id() and brand = 'Toyota' and price_cents < 5000000
        order by price_cents limit 12
      `,
    },
    {
      label: 'backoffice · listado de stock',
      budgetMs: 40,
      scope: 'tenant',
      mustUseIndexOn: ['vehicles'],
      query: sql`
        select v.id, v.brand, v.model, v.status, v.list_price_amount_cents,
          (select i.blob_url from vehicle_images i where i.vehicle_id = v.id
            order by i.is_cover desc, i.position limit 1) as cover_url,
          (select count(*)::int from vehicle_images i where i.vehicle_id = v.id) as image_count,
          f.acquisition_base_cents, f.costs_base_cents, f.gross_margin_base_cents
        from vehicles v
        left join vehicle_financials f on f.vehicle_id = v.id
        order by v.created_at desc, v.id desc
        limit 24
      `,
    },
    {
      label: 'backoffice · timeline de un vehículo',
      budgetMs: 25,
      scope: 'tenant',
      mustUseIndexOn: ['vehicle_events'],
      query: sql`
        select e.* from vehicle_events e
        where e.vehicle_id = (select id from vehicles limit 1)
        order by e.id desc limit 30
      `,
    },
    {
      label: 'dashboard · cartera y capital inmovilizado',
      budgetMs: 40,
      scope: 'tenant',
      query: sql`
        select
          count(*) filter (where v.ownership = 'OWNED')::int,
          coalesce(sum(f.acquisition_base_cents) filter (where v.ownership = 'OWNED'), 0),
          coalesce(sum(f.costs_base_cents), 0)
        from vehicles v
        left join vehicle_financials f on f.vehicle_id = v.id
        where v.status in ('INGRESADO','EN_PREPARACION','PUBLICADO','RESERVADO','PAUSADO')
      `,
    },
    {
      label: 'dashboard · margen por mes',
      budgetMs: 40,
      scope: 'tenant',
      query: sql`
        select to_char(date_trunc('month', v.sold_at), 'YYYY-MM'),
               count(*)::int, coalesce(sum(f.gross_margin_base_cents), 0)
        from vehicles v
        join vehicle_financials f on f.vehicle_id = v.id
        where v.status = 'VENDIDO' and v.sold_at > now() - interval '12 months'
        group by 1
      `,
    },
    {
      label: 'bandeja de consultas',
      budgetMs: 25,
      scope: 'tenant',
      mustUseIndexOn: ['leads'],
      query: sql`
        select l.* from leads l
        where l.status = 'NEW'
        order by l.created_at desc limit 30
      `,
    },
    {
      label: 'agenda de la semana',
      budgetMs: 25,
      scope: 'tenant',
      mustUseIndexOn: ['appointments'],
      query: sql`
        select a.* from appointments a
        where a.starts_at >= now() and a.starts_at < now() + interval '7 days'
        order by a.starts_at
      `,
    },
  ];
}

async function measure(check: Check, ctx: { agencyId: string; userId: string; role: 'OWNER' }) {
  const run = <T>(fn: (tx: Tx) => Promise<T>) =>
    check.scope === 'tenant' ? withTenant(ctx, fn) : withPublicAgency(ctx.agencyId, fn);

  // Una corrida en frío mide el planificador y el caché vacío, no la consulta.
  await run((tx) => tx.execute(check.query));

  const rows = await run((tx) =>
    tx.execute<Record<string, unknown>>(
      sql`explain (analyze, buffers, format json) ${check.query}`,
    ),
  );

  const raw = rows[0]?.['QUERY PLAN'];
  const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
    Plan: PlanNode;
    'Execution Time': number;
  }[];

  const root = parsed[0]!;
  const scans: string[] = [];
  const seqScans: string[] = [];

  collect(root.Plan, scans, seqScans);

  const ms = root['Execution Time'];
  const forbidden = seqScans.filter((table) => check.mustUseIndexOn?.includes(table));

  return {
    label: check.label,
    ms,
    budgetMs: check.budgetMs,
    scans,
    seqScans: forbidden,
    ok: ms <= check.budgetMs && forbidden.length === 0,
  };
}

type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
};

function collect(node: PlanNode, scans: string[], seqScans: string[]) {
  const type = node['Node Type'];

  if (type.includes('Scan')) {
    const table = node['Relation Name'] ?? '?';
    scans.push(`${type}${node['Index Name'] ? ` usando ${node['Index Name']}` : ''} en ${table}`);
    if (type === 'Seq Scan') seqScans.push(table);
  }

  for (const child of node.Plans ?? []) collect(child, scans, seqScans);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
