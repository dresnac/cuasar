import {
  and,
  asc,
  count,
  dbAdmin,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  schema,
  sql,
  uuidv7,
  withPublicAgency,
} from '@cuasar/db';
import { z } from 'zod';
import { fail, ok, type Result } from '../errors';
import { enqueue } from './outbox';

const { agencies, agencySettings, vehiclePublicView, leads, vehicleEvents } = schema;

/**
 * El sitio público de cada agencia.
 *
 * Todo lo que se lee acá sale de `vehicle_public_view`, la proyección que
 * mantienen los triggers: el listado es un SELECT sin joins, con las fotos
 * embebidas. Es el query más caliente del sistema y no puede depender de
 * cuatro tablas.
 *
 * Nada de esto pasa por `vehicles`: el rol `app_public` ni siquiera tiene
 * permiso para leer esa tabla, así que un precio de compra no puede
 * filtrarse al catálogo ni por error de programación.
 */

export type PublicAgency = {
  agencyId: string;
  name: string;
  slug: string;
  baseCurrency: string;
  branding: Record<string, unknown>;
  contact: Record<string, unknown>;
  social: Record<string, unknown>;
  seo: Record<string, unknown>;
  publicDomain: string | null;
};

/**
 * Dominio → agencia.
 *
 * Corre con el rol dueño porque es la consulta que *establece* el contexto:
 * todavía no se sabe de qué agencia se trata. Es el único lugar del sitio
 * público que mira fuera de una agencia, y solo lee identidad y branding.
 *
 * La capa que la llama la cachea por host. Si más adelante conviene sacarla
 * de la base y ponerla en un store de configuración replicado, se cambia
 * esta función y nada más.
 */
export async function resolveAgencyByHost(host: string): Promise<PublicAgency | null> {
  const hostname = normalizeHost(host);
  if (!hostname) return null;

  const rootDomain = normalizeHost(process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'cuasar.app') ?? 'cuasar.app';
  const subdomain = hostname.endsWith(`.${rootDomain}`)
    ? hostname.slice(0, -(rootDomain.length + 1))
    : null;

  const [row] = await dbAdmin
    .select({
      agencyId: agencies.id,
      name: agencies.name,
      slug: agencies.slug,
      baseCurrency: agencies.baseCurrency,
      branding: agencySettings.branding,
      contact: agencySettings.contact,
      social: agencySettings.social,
      seo: agencySettings.seo,
      publicDomain: agencySettings.publicDomain,
    })
    .from(agencies)
    .innerJoin(agencySettings, eq(agencySettings.agencyId, agencies.id))
    .where(
      and(
        eq(agencies.status, 'ACTIVE'),
        subdomain
          ? eq(agencies.slug, subdomain)
          : and(
              eq(agencySettings.publicDomain, hostname),
              sql`${agencySettings.publicDomainVerifiedAt} is not null`,
            ),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    ...row,
    branding: (row.branding ?? {}) as Record<string, unknown>,
    contact: (row.contact ?? {}) as Record<string, unknown>,
    social: (row.social ?? {}) as Record<string, unknown>,
    seo: (row.seo ?? {}) as Record<string, unknown>,
  };
}

/** Ya resuelto el dominio, la agencia por id. Es lo que lee cada página. */
export async function getPublicAgencyById(agencyId: string): Promise<PublicAgency | null> {
  const [row] = await dbAdmin
    .select({
      agencyId: agencies.id,
      name: agencies.name,
      slug: agencies.slug,
      baseCurrency: agencies.baseCurrency,
      branding: agencySettings.branding,
      contact: agencySettings.contact,
      social: agencySettings.social,
      seo: agencySettings.seo,
      publicDomain: agencySettings.publicDomain,
    })
    .from(agencies)
    .innerJoin(agencySettings, eq(agencySettings.agencyId, agencies.id))
    .where(and(eq(agencies.id, agencyId), eq(agencies.status, 'ACTIVE')))
    .limit(1);

  if (!row) return null;

  return {
    ...row,
    branding: (row.branding ?? {}) as Record<string, unknown>,
    contact: (row.contact ?? {}) as Record<string, unknown>,
    social: (row.social ?? {}) as Record<string, unknown>,
    seo: (row.seo ?? {}) as Record<string, unknown>,
  };
}

/** Por el slug, para desarrollo y para previsualizar desde el backoffice. */
export async function resolveAgencyBySlug(slug: string): Promise<PublicAgency | null> {
  return resolveAgencyByHost(`${slug}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'cuasar.app'}`);
}

function normalizeHost(host: string): string | null {
  const clean = host.trim().toLowerCase().split(':')[0];
  if (!clean) return null;
  return clean.startsWith('www.') ? clean.slice(4) : clean;
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export const catalogFilters = z.object({
  q: z.string().max(80).optional(),
  brand: z.string().max(60).optional(),
  yearFrom: z.coerce.number().int().optional(),
  priceMax: z.coerce.bigint().optional(),
  sort: z.enum(['recent', 'price_asc', 'price_desc', 'km_asc']).default('recent'),
  page: z.coerce.number().int().min(1).max(200).default(1),
});

export type CatalogFilters = z.infer<typeof catalogFilters>;

export type CatalogImage = { url: string; width: number; height: number; blur: string | null };

export type CatalogItem = {
  slug: string;
  brand: string;
  model: string;
  version: string | null;
  year: number;
  km: number;
  fuel: string | null;
  transmission: string | null;
  priceCents: bigint;
  priceCurrency: string;
  images: CatalogImage[];
  imageCount: number;
};

const PAGE_SIZE = 12;

export async function listCatalog(agencyId: string, raw: unknown) {
  const f = catalogFilters.parse(raw ?? {});

  return withPublicAgency(agencyId, async (tx) => {
    const where = [
      f.brand ? eq(vehiclePublicView.brand, f.brand) : undefined,
      f.yearFrom ? gte(vehiclePublicView.year, f.yearFrom) : undefined,
      f.priceMax ? lte(vehiclePublicView.priceCents, f.priceMax) : undefined,
      f.q
        ? or(
            ilike(vehiclePublicView.searchText, `%${f.q.toLowerCase()}%`),
            ilike(vehiclePublicView.description, `%${f.q}%`),
          )
        : undefined,
    ].filter(Boolean);

    const [rows, [total]] = await Promise.all([
      tx
        .select()
        .from(vehiclePublicView)
        .where(and(...where))
        .orderBy(...catalogOrder(f.sort))
        .limit(PAGE_SIZE)
        .offset((f.page - 1) * PAGE_SIZE),
      tx.select({ n: count() }).from(vehiclePublicView).where(and(...where)),
    ]);

    return {
      items: rows.map(toCatalogItem),
      total: Number(total?.n ?? 0),
      page: f.page,
      pageSize: PAGE_SIZE,
      pages: Math.max(1, Math.ceil(Number(total?.n ?? 0) / PAGE_SIZE)),
    };
  });
}

function catalogOrder(sort: CatalogFilters['sort']) {
  switch (sort) {
    case 'price_asc':
      return [asc(vehiclePublicView.priceCents), asc(vehiclePublicView.vehicleId)];
    case 'price_desc':
      return [desc(vehiclePublicView.priceCents), desc(vehiclePublicView.vehicleId)];
    case 'km_asc':
      return [asc(vehiclePublicView.km), asc(vehiclePublicView.vehicleId)];
    default:
      return [desc(vehiclePublicView.publishedAt), desc(vehiclePublicView.vehicleId)];
  }
}

type ViewRow = typeof vehiclePublicView.$inferSelect;

function toCatalogItem(row: ViewRow): CatalogItem {
  return {
    slug: row.slug,
    brand: row.brand,
    model: row.model,
    version: row.version,
    year: row.year,
    km: row.km,
    fuel: row.fuel,
    transmission: row.transmission,
    priceCents: row.priceCents,
    priceCurrency: row.priceCurrency,
    images: (row.images ?? []) as CatalogImage[],
    imageCount: row.imageCount,
  };
}

export type PublicVehicle = CatalogItem & {
  vehicleId: string;
  color: string | null;
  doors: number | null;
  description: string | null;
  features: string[];
  publishedAt: Date;
};

export async function getPublicVehicle(
  agencyId: string,
  slug: string,
): Promise<PublicVehicle | null> {
  return withPublicAgency(agencyId, async (tx) => {
    const [row] = await tx
      .select()
      .from(vehiclePublicView)
      .where(eq(vehiclePublicView.slug, slug))
      .limit(1);

    if (!row) return null;

    return {
      ...toCatalogItem(row),
      vehicleId: row.vehicleId,
      color: row.color,
      doors: row.doors,
      description: row.description,
      features: (row.features ?? []) as string[],
      publishedAt: row.publishedAt,
    };
  });
}

/** Marcas y rangos presentes en el catálogo, para armar los filtros. */
export async function getCatalogFacets(agencyId: string) {
  return withPublicAgency(agencyId, async (tx) => {
    const [brands, [range]] = await Promise.all([
      tx
        .selectDistinct({ brand: vehiclePublicView.brand })
        .from(vehiclePublicView)
        .orderBy(asc(vehiclePublicView.brand)),
      tx
        .select({
          minPrice: sql<string>`coalesce(min(price_cents), 0)`.as('min_price'),
          maxPrice: sql<string>`coalesce(max(price_cents), 0)`.as('max_price'),
          minYear: sql<number>`coalesce(min(year), 0)::int`.as('min_year'),
          maxYear: sql<number>`coalesce(max(year), 0)::int`.as('max_year'),
        })
        .from(vehiclePublicView),
    ]);

    return {
      brands: brands.map((b) => b.brand),
      minPriceCents: BigInt(range?.minPrice ?? '0'),
      maxPriceCents: BigInt(range?.maxPrice ?? '0'),
      minYear: range?.minYear ?? 0,
      maxYear: range?.maxYear ?? 0,
    };
  });
}

/** Todo lo publicado, para el sitemap. */
export async function listCatalogSlugs(agencyId: string) {
  return withPublicAgency(agencyId, (tx) =>
    tx
      .select({ slug: vehiclePublicView.slug, updatedAt: vehiclePublicView.updatedAt })
      .from(vehiclePublicView)
      .orderBy(desc(vehiclePublicView.publishedAt)),
  );
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export const leadInput = z.object({
  name: z.string().trim().min(2, 'Poné tu nombre.').max(80),
  email: z.string().trim().email('Revisá el mail.').max(120).optional().or(z.literal('')),
  phone: z.string().trim().min(6, 'Dejá un teléfono para que te contesten.').max(30),
  message: z.string().trim().max(1000).optional(),
  vehicleSlug: z.string().max(120).optional(),
});

/** Cuántas consultas puede dejar un mismo teléfono por hora, por agencia. */
const LEAD_LIMIT_PER_HOUR = 3;

export async function createPublicLead(
  agencyId: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = leadInput.safeParse(raw);
  if (!parsed.success) {
    return fail('VALIDATION', parsed.error.issues[0]?.message ?? 'Revisá los datos.');
  }
  const input = parsed.data;

  // El conteo va con el rol dueño porque `app_public` no puede leer leads —
  // y no debería: un formulario que pudiera releer la bandeja sería una
  // filtración de datos de contacto.
  const [recent] = await dbAdmin
    .select({ n: count() })
    .from(leads)
    .where(
      and(
        eq(leads.agencyId, agencyId),
        eq(leads.phone, input.phone),
        gte(leads.createdAt, new Date(Date.now() - 3_600_000)),
      ),
    );

  if (Number(recent?.n ?? 0) >= LEAD_LIMIT_PER_HOUR) {
    return fail(
      'QUOTA_EXCEEDED',
      'Ya dejaste varias consultas en la última hora. La agencia las tiene y te va a contestar.',
    );
  }

  return withPublicAgency(agencyId, async (tx) => {
    let vehicleId: string | null = null;

    if (input.vehicleSlug) {
      const [vehicle] = await tx
        .select({ id: vehiclePublicView.vehicleId })
        .from(vehiclePublicView)
        .where(eq(vehiclePublicView.slug, input.vehicleSlug))
        .limit(1);
      vehicleId = vehicle?.id ?? null;
    }

    // El id se genera acá en vez de pedirlo con RETURNING: un INSERT con
    // RETURNING necesita permiso de lectura sobre la tabla, y el rol público
    // no lo tiene ni debería. Sin lectura no hay forma de que el formulario
    // se convierta en una ventana a la bandeja de consultas.
    const leadId = uuidv7();

    await tx
      .insert(leads)
      .values({
        id: leadId,
        agencyId,
        vehicleId,
        name: input.name,
        email: input.email || null,
        phone: input.phone,
        message: input.message || null,
        source: 'PUBLIC_SITE',
        status: 'NEW',
      });

    // La consulta también es parte de la historia de la unidad: quien abra
    // la ficha mañana tiene que ver que alguien preguntó por ella.
    if (vehicleId) {
      await tx.insert(vehicleEvents).values({
        agencyId,
        vehicleId,
        type: 'LEAD_RECEIVED',
        source: 'WEB',
        payload: { leadId },
      });
    }

    // La notificación se encola con la misma transacción: si el lead no se
    // guardó, el mail no sale. El payload lleva solo el id —los datos de
    // contacto los busca el worker al momento de mandar— así que anonimizar
    // una consulta antes de que salga el mail tampoco la filtra.
    await enqueue(tx, agencyId, 'lead.received', { leadId });

    return ok({ id: leadId });
  });
}
