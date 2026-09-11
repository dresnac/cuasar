import { dbAdmin, pgClient, schema, sql, withPublicAgency } from '@cuasar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicLead,
  getCatalogFacets,
  getPublicVehicle,
  listCatalog,
  listCatalogSlugs,
  resolveAgencyByHost,
} from '../src/services';

/**
 * El sitio público.
 *
 * Es la única parte del sistema abierta a internet sin autenticación, así
 * que la mitad de estos tests no prueban que algo funcione: prueban que algo
 * NO se pueda hacer. Si el rol `app_public` alguna vez puede leer `vehicles`,
 * el precio de compra de cada unidad queda a un query de distancia.
 *
 * Requiere: pnpm db:migrate && pnpm db:seed
 */

let sur: string;
let norte: string;
const createdLeads: string[] = [];

async function expectDbError(run: () => Promise<unknown>, pattern: RegExp) {
  try {
    await run();
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause;
    expect(cause?.message ?? (err as Error).message).toMatch(pattern);
    return;
  }
  throw new Error(`Se esperaba un error que matchee ${pattern}, pero no hubo error.`);
}

beforeAll(async () => {
  const rows = await dbAdmin.execute<{ id: string; slug: string }>(
    sql`select id, slug from agencies order by slug`,
  );
  sur = rows.find((r) => r.slug === 'del-sur')!.id;
  norte = rows.find((r) => r.slug === 'norte-motors')!.id;
});

afterAll(async () => {
  await dbAdmin.execute(sql`delete from leads where phone like '+54 9 11 TEST%'`);
  await pgClient.end();
});

describe('resolución de dominio', () => {
  it('un subdominio encuentra su agencia', async () => {
    const agency = await resolveAgencyByHost('del-sur.cuasar.app');
    expect(agency?.agencyId).toBe(sur);
    expect(agency?.name).toBe('Automotores del Sur');
  });

  it('ignora el www y el puerto', async () => {
    expect((await resolveAgencyByHost('www.del-sur.cuasar.app:3001'))?.agencyId).toBe(sur);
  });

  it('un host desconocido no resuelve a ninguna agencia', async () => {
    expect(await resolveAgencyByHost('otra-cosa.cuasar.app')).toBeNull();
    expect(await resolveAgencyByHost('ejemplo.com')).toBeNull();
  });

  it('un dominio propio sin verificar no sirve: cualquiera podría reclamarlo', async () => {
    await dbAdmin.execute(sql`
      update agency_settings set public_domain = 'delsurautos.test',
                                 public_domain_verified_at = null
      where agency_id = ${sur}
    `);
    expect(await resolveAgencyByHost('delsurautos.test')).toBeNull();

    await dbAdmin.execute(sql`
      update agency_settings set public_domain_verified_at = now() where agency_id = ${sur}
    `);
    expect((await resolveAgencyByHost('delsurautos.test'))?.agencyId).toBe(sur);

    await dbAdmin.execute(sql`
      update agency_settings set public_domain = null, public_domain_verified_at = null
      where agency_id = ${sur}
    `);
  });

  it('una agencia suspendida desaparece de la web', async () => {
    await dbAdmin.execute(sql`update agencies set status = 'SUSPENDED' where id = ${sur}`);
    expect(await resolveAgencyByHost('del-sur.cuasar.app')).toBeNull();

    // Suspender también le vacía el catálogo, por el trigger de la proyección.
    const rows = await dbAdmin.execute(
      sql`select 1 from vehicle_public_view where agency_id = ${sur}`,
    );
    expect(rows).toHaveLength(0);

    await dbAdmin.execute(sql`update agencies set status = 'ACTIVE' where id = ${sur}`);
  });
});

describe('catálogo', () => {
  it('muestra solo lo publicado de esa agencia', async () => {
    const catalog = await listCatalog(sur, {});
    expect(catalog.items.length).toBeGreaterThan(0);
    expect(catalog.total).toBe(catalog.items.length);

    const published = await dbAdmin.execute<{ n: number }>(sql`
      select count(*)::int as n from vehicles
      where agency_id = ${sur} and status = 'PUBLICADO'
    `);
    expect(catalog.total).toBe(published[0]!.n);
  });

  it('cada aviso llega con sus fotos, sin joins de por medio', async () => {
    const catalog = await listCatalog(sur, {});
    const item = catalog.items[0]!;
    expect(item.images.length).toBeGreaterThan(0);
    expect(item.images[0]!.url).toMatch(/^https?:\/\//);
  });

  it('filtra por marca y ordena por precio', async () => {
    const facets = await getCatalogFacets(sur);
    expect(facets.brands.length).toBeGreaterThan(0);

    const byBrand = await listCatalog(sur, { brand: facets.brands[0] });
    expect(byBrand.items.every((i) => i.brand === facets.brands[0])).toBe(true);

    const asc = await listCatalog(sur, { sort: 'price_asc' });
    const prices = asc.items.map((i) => i.priceCents);
    expect(prices).toEqual([...prices].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('la ficha se busca por slug dentro de la agencia, nunca fuera', async () => {
    const catalog = await listCatalog(sur, {});
    const slug = catalog.items[0]!.slug;

    const mine = await getPublicVehicle(sur, slug);
    expect(mine?.slug).toBe(slug);

    // Dos agencias pueden tener el mismo slug —cada una vive en su dominio—,
    // pero pedirlo desde una nunca puede devolver la unidad de la otra.
    const fromOther = await getPublicVehicle(norte, slug);
    expect(fromOther?.vehicleId).not.toBe(mine!.vehicleId);
  });

  it('el sitemap lista lo mismo que el catálogo', async () => {
    const [slugs, catalog] = await Promise.all([listCatalogSlugs(sur), listCatalog(sur, {})]);
    expect(slugs).toHaveLength(catalog.total);
  });
});

describe('lo que el sitio público NO puede hacer', () => {
  it('no puede leer la tabla de vehículos, donde vive el precio de compra', async () => {
    await expectDbError(
      () => withPublicAgency(sur, (tx) => tx.execute(sql`select * from vehicles limit 1`)),
      /permission denied/i,
    );
  });

  it('no puede leer la contabilidad', async () => {
    await expectDbError(
      () =>
        withPublicAgency(sur, (tx) => tx.execute(sql`select * from vehicle_financials limit 1`)),
      /permission denied/i,
    );
  });

  it('no puede releer las consultas que recibe', async () => {
    await expectDbError(
      () => withPublicAgency(sur, (tx) => tx.execute(sql`select name, phone from leads limit 1`)),
      /permission denied/i,
    );
  });

  it('no puede editar ni borrar nada del catálogo', async () => {
    await expectDbError(
      () =>
        withPublicAgency(sur, (tx) =>
          tx.execute(sql`update vehicle_public_view set price_cents = 1`),
        ),
      /permission denied/i,
    );
  });

  it('no ve el catálogo de otra agencia aunque comparta la conexión', async () => {
    const fromNorte = await withPublicAgency(norte, (tx) =>
      tx.execute<{ agency_id: string }>(sql`select agency_id from vehicle_public_view`),
    );
    expect(fromNorte.every((r) => r.agency_id === norte)).toBe(true);
  });

  it('no puede dejar una consulta a nombre de otra agencia', async () => {
    await expectDbError(
      () =>
        withPublicAgency(sur, (tx) =>
          tx.execute(sql`
            insert into leads (agency_id, name, phone, source)
            values (${norte}, 'Intruso', '+54 9 11 000', 'PUBLIC_SITE')
          `),
        ),
      /row-level security/i,
    );
  });
});

describe('consultas', () => {
  it('deja la consulta y la suma al historial de la unidad', async () => {
    const catalog = await listCatalog(sur, {});
    const item = catalog.items[0]!;

    const result = await createPublicLead(sur, {
      name: 'Persona interesada',
      phone: '+54 9 11 TEST 001',
      email: 'interesado@example.com',
      message: '¿Aceptan permuta?',
      vehicleSlug: item.slug,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdLeads.push(result.data.id);

    const events = await dbAdmin.execute<{ payload: { leadId: string } }>(sql`
      select payload from vehicle_events
      where agency_id = ${sur} and type = 'LEAD_RECEIVED'
      order by occurred_at desc limit 1
    `);
    expect(events[0]?.payload.leadId).toBe(result.data.id);
  });

  it('pide un teléfono: un mail sin teléfono no sirve para vender un auto', async () => {
    const result = await createPublicLead(sur, {
      name: 'Sin teléfono',
      email: 'x@example.com',
      phone: '',
    });
    expect(result.ok).toBe(false);
  });

  it('corta después de tres consultas por hora del mismo teléfono', async () => {
    const phone = '+54 9 11 TEST 999';
    for (let i = 0; i < 3; i++) {
      const r = await createPublicLead(sur, { name: `Insistente ${i}`, phone });
      expect(r.ok).toBe(true);
    }

    const blocked = await createPublicLead(sur, { name: 'Insistente 4', phone });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('QUOTA_EXCEEDED');
  });
});
