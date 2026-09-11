import './env';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { dbAdmin, pgClient } from './client';
import * as s from './schema';

/**
 * Datos de prueba con forma realista: dos agencias con moneda base
 * distinta (una opera en USD, otra en pesos), autos propios y en
 * consignación, vendidos y en stock. Es lo que hace falta para que los
 * números del dashboard y el aislamiento entre tenants se puedan mirar
 * de verdad, no para que las pantallas "tengan algo".
 */

const usd = (n: number) => BigInt(Math.round(n * 100));
const ARS_PER_USD = '1450.50';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function main() {
  console.log('→ limpiando');
  await dbAdmin.execute(sql`
    truncate table
      agencies, users, plans, platform_admins, audit_log, billing_events
    restart identity cascade
  `);

  console.log('→ planes');
  await dbAdmin.insert(s.plans).values({
    code: 'base',
    name: 'Cuasar Base',
    priceCents: usd(100),
    currency: 'USD',
    includedSeats: 5,
    extraSeatPriceCents: usd(20),
    vehicleLimit: null,
    features: { publicSite: true, customDomain: true, integrations: false },
  });

  console.log('→ agencias');
  const sur = await seedAgency({
    name: 'Automotores del Sur',
    slug: 'del-sur',
    baseCurrency: 'USD',
    brandColor: '#1b4de4',
    phone: '+54 11 5555-0000',
    address: 'Av. Hipólito Yrigoyen 4820',
    city: 'Lanús',
    tagline: 'Usados seleccionados con garantía escrita y service al día.',
    owner: { email: 'owner@delsur.test', name: 'Marina Sosa' },
    sales: { email: 'ventas@delsur.test', name: 'Diego Paredes' },
  });

  const norte = await seedAgency({
    name: 'Norte Motors',
    slug: 'norte-motors',
    baseCurrency: 'ARS',
    brandColor: '#a8432a',
    phone: '+54 11 4777-1200',
    address: 'Av. Maipú 2340',
    city: 'Olivos',
    tagline: 'Camionetas y SUVs revisadas, financiación en el acto.',
    owner: { email: 'owner@nortemotors.test', name: 'Lucía Ferrer' },
    sales: { email: 'ventas@nortemotors.test', name: 'Tomás Aguirre' },
  });

  console.log('→ moderador de plataforma');
  const [modUser] = await dbAdmin
    .insert(s.users)
    .values({ externalId: 'seed_platform_mod', email: 'mod@cuasar.app', name: 'Soporte Cuasar' })
    .returning();
  await dbAdmin.insert(s.platformAdmins).values({ userId: modUser!.id, level: 'ADMIN' });

  const counts = await dbAdmin.execute<{ table_name: string; n: number }>(sql`
    select 'vehiculos' as table_name, count(*)::int as n from vehicles
    union all select 'publicados', count(*)::int from vehicle_public_view
    union all select 'costos', count(*)::int from vehicle_costs
    union all select 'eventos', count(*)::int from vehicle_events
    union all select 'leads', count(*)::int from leads
    union all select 'turnos', count(*)::int from appointments
  `);

  console.log('\n✓ seed listo');
  console.table(counts);
  console.log(`\n  ${sur.slug}   → agencyId ${sur.agencyId}`);
  console.log(`  ${norte.slug} → agencyId ${norte.agencyId}`);
}

type AgencySeed = {
  name: string;
  slug: string;
  baseCurrency: 'USD' | 'ARS';
  brandColor: string;
  phone: string;
  address: string;
  city: string;
  tagline: string;
  owner: { email: string; name: string };
  sales: { email: string; name: string };
};

async function seedAgency(spec: AgencySeed) {
  const [agency] = await dbAdmin
    .insert(s.agencies)
    .values({
      name: spec.name,
      slug: spec.slug,
      baseCurrency: spec.baseCurrency,
      status: 'ACTIVE',
    })
    .returning();

  const agencyId = agency!.id;

  await dbAdmin.insert(s.agencySettings).values({
    agencyId,
    // Colores distintos a propósito: es la forma más rápida de ver que cada
    // agencia tiene su sitio y no una copia del mismo.
    branding: { primary: spec.brandColor, logoUrl: null },
    contact: {
      phone: spec.phone,
      address: spec.address,
      city: spec.city,
      hours: 'Lunes a viernes de 9 a 18, sábados de 9 a 13',
    },
    seo: { title: spec.name, description: spec.tagline },
  });

  const people = await dbAdmin
    .insert(s.users)
    .values([
      { externalId: `seed_${spec.slug}_owner`, email: spec.owner.email, name: spec.owner.name },
      { externalId: `seed_${spec.slug}_sales`, email: spec.sales.email, name: spec.sales.name },
    ])
    .returning();

  const owner = people[0]!;
  const sales = people[1]!;

  await dbAdmin.insert(s.memberships).values([
    { agencyId, userId: owner.id, role: 'OWNER', status: 'ACTIVE', activatedAt: new Date() },
    { agencyId, userId: sales.id, role: 'SALES', status: 'ACTIVE', activatedAt: new Date() },
  ]);

  await dbAdmin.insert(s.subscriptions).values({
    agencyId,
    planCode: 'base',
    status: 'ACTIVE',
    provider: spec.baseCurrency === 'ARS' ? 'MERCADOPAGO' : 'STRIPE',
    providerCustomerId: `seed_cus_${spec.slug}`,
    providerSubscriptionId: `seed_sub_${spec.slug}`,
    currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
    seatsPurchased: 5,
  });

  // Horario de atención: lunes a viernes de 9 a 18, sábados de 9 a 13.
  // Sin esto la agenda no tiene de dónde sacar huecos libres.
  await dbAdmin.insert(s.availability).values([
    ...[1, 2, 3, 4, 5].map((weekday) => ({
      agencyId,
      userId: null,
      weekday,
      fromTime: '09:00:00',
      toTime: '18:00:00',
    })),
    { agencyId, userId: null, weekday: 6, fromTime: '09:00:00', toTime: '13:00:00' },
  ]);

  const fleet = buildFleet(spec.baseCurrency);

  for (const v of fleet) {
    await seedVehicle({ agencyId, actorId: owner.id, salesId: sales.id, spec, vehicle: v });
  }

  return { agencyId, slug: spec.slug, ownerId: owner.id, salesId: sales.id };
}

type FleetItem = ReturnType<typeof buildFleet>[number];

function buildFleet(base: 'USD' | 'ARS') {
  // Los precios se cargan en USD (así se opera el usado en Argentina) y se
  // convierten a la base de la agencia con la cotización del momento.
  const rate = base === 'USD' ? '1' : ARS_PER_USD;

  return [
    {
      brand: 'Toyota', model: 'Corolla', version: 'XEI 2.0 CVT', year: 2021, km: 48_000,
      fuel: 'NAFTA' as const, transmission: 'AUTOMATICA' as const, color: 'Gris plata', doors: 4,
      ownership: 'OWNED' as const, status: 'PUBLICADO' as const,
      listUsd: 24_500, buyUsd: 21_000, ageDays: 34, rate,
      costs: [
        { category: 'DETAILING' as const, usd: 180, label: 'Lavado y pulido' },
        { category: 'MECHANICAL' as const, usd: 620, label: 'Service completo' },
      ],
      sale: null,
    },
    {
      brand: 'Volkswagen', model: 'Amarok', version: 'V6 Highline', year: 2020, km: 92_000,
      fuel: 'DIESEL' as const, transmission: 'AUTOMATICA' as const, color: 'Blanco', doors: 4,
      ownership: 'OWNED' as const, status: 'VENDIDO' as const,
      listUsd: 38_000, buyUsd: 32_500, ageDays: 96, rate,
      costs: [
        { category: 'BODYWORK' as const, usd: 1_450, label: 'Chapa y pintura puerta trasera' },
        { category: 'PAPERWORK' as const, usd: 320, label: 'Transferencia' },
      ],
      sale: { usd: 37_200, daysAfter: 71 },
    },
    {
      brand: 'Ford', model: 'Ranger', version: 'Limited 3.2', year: 2019, km: 110_000,
      fuel: 'DIESEL' as const, transmission: 'AUTOMATICA' as const, color: 'Azul', doors: 4,
      ownership: 'CONSIGNMENT' as const, status: 'PUBLICADO' as const,
      listUsd: 29_900, buyUsd: 0, ageDays: 12, rate,
      costs: [{ category: 'DETAILING' as const, usd: 150, label: 'Detailing de entrega' }],
      sale: null,
      consignment: { name: 'Ricardo Méndez', floorUsd: 28_000, type: 'PCT' as const, value: '5' },
    },
    {
      brand: 'Chevrolet', model: 'Cruze', version: 'LTZ 1.4 Turbo', year: 2022, km: 31_000,
      fuel: 'NAFTA' as const, transmission: 'AUTOMATICA' as const, color: 'Rojo', doors: 5,
      ownership: 'CONSIGNMENT' as const, status: 'VENDIDO' as const,
      listUsd: 23_500, buyUsd: 0, ageDays: 64, rate,
      costs: [{ category: 'MARKETING' as const, usd: 90, label: 'Publicación destacada' }],
      sale: { usd: 22_800, daysAfter: 41 },
      consignment: { name: 'Estela Ríos', floorUsd: 21_500, type: 'PCT' as const, value: '6' },
    },
    {
      brand: 'Peugeot', model: '208', version: 'Allure 1.6', year: 2023, km: 18_500,
      fuel: 'NAFTA' as const, transmission: 'MANUAL' as const, color: 'Negro', doors: 5,
      ownership: 'OWNED' as const, status: 'EN_PREPARACION' as const,
      listUsd: 19_800, buyUsd: 17_400, ageDays: 6, rate,
      costs: [{ category: 'MECHANICAL' as const, usd: 240, label: 'Cubiertas delanteras' }],
      sale: null,
    },
    {
      brand: 'Renault', model: 'Duster', version: 'Iconic 1.3T', year: 2021, km: 67_000,
      fuel: 'NAFTA' as const, transmission: 'AUTOMATICA' as const, color: 'Gris', doors: 5,
      ownership: 'OWNED' as const, status: 'RESERVADO' as const,
      listUsd: 21_200, buyUsd: 18_900, ageDays: 51, rate,
      costs: [
        { category: 'TRANSPORT' as const, usd: 310, label: 'Traslado desde Córdoba' },
        { category: 'DETAILING' as const, usd: 160, label: 'Lavado' },
      ],
      sale: null,
    },
    {
      brand: 'Fiat', model: 'Cronos', version: 'Drive 1.3', year: 2020, km: 74_000,
      fuel: 'NAFTA' as const, transmission: 'MANUAL' as const, color: 'Blanco', doors: 4,
      ownership: 'OWNED' as const, status: 'PAUSADO' as const,
      listUsd: 13_400, buyUsd: 12_600, ageDays: 128, rate,
      costs: [{ category: 'MECHANICAL' as const, usd: 890, label: 'Embrague' }],
      sale: null,
    },
    {
      brand: 'Honda', model: 'HR-V', version: 'EXL CVT', year: 2022, km: 39_000,
      fuel: 'NAFTA' as const, transmission: 'AUTOMATICA' as const, color: 'Gris oscuro', doors: 5,
      ownership: 'OWNED' as const, status: 'PUBLICADO' as const,
      listUsd: 27_900, buyUsd: 24_800, ageDays: 19, rate,
      costs: [{ category: 'PAPERWORK' as const, usd: 280, label: 'Verificación policial' }],
      sale: null,
    },
  ];
}

async function seedVehicle(args: {
  agencyId: string;
  actorId: string;
  salesId: string;
  spec: AgencySeed;
  vehicle: FleetItem;
}) {
  const { agencyId, actorId, salesId, spec, vehicle: v } = args;
  const currency = spec.baseCurrency;
  const toBase = (amountUsd: number) =>
    currency === 'USD' ? usd(amountUsd) : usd(amountUsd * Number(ARS_PER_USD));

  const id = uuidv7();
  const acquiredAt = daysAgo(v.ageDays);
  const slug = `${v.brand}-${v.model}-${v.year}-${id.replace(/-/g, '').slice(-6)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

  const soldAt = v.sale ? daysAgo(v.ageDays - v.sale.daysAfter) : null;

  await dbAdmin.insert(s.vehicles).values({
    id,
    agencyId,
    brand: v.brand,
    model: v.model,
    version: v.version,
    year: v.year,
    km: v.km,
    fuel: v.fuel,
    transmission: v.transmission,
    color: v.color,
    doors: v.doors,
    ownership: v.ownership,
    status: v.status,
    acquiredAt,
    publishedAt: ['PUBLICADO', 'RESERVADO', 'VENDIDO'].includes(v.status)
      ? daysAgo(v.ageDays - 2)
      : null,
    soldAt,
    licensePlate: plate(id),
    listPriceAmountCents: usd(v.listUsd),
    listPriceCurrency: 'USD',
    listPriceFxRate: v.rate,
    listPriceAmountBaseCents: toBase(v.listUsd),
    floorPriceCents: toBase(Math.round(v.listUsd * 0.94)),
    description: `${v.brand} ${v.model} ${v.version ?? ''} ${v.year}. Unidad revisada, service al día.`,
    features: ['Bluetooth', 'Cámara de retroceso', 'Control de estabilidad'],
    slug,
  });

  // Las imágenes entran antes de publicar: la máquina de estados no deja
  // publicar sin fotos, y el seed respeta las mismas reglas que la app.
  await dbAdmin.insert(s.vehicleImages).values(
    Array.from({ length: 6 }, (_, i) => ({
      agencyId,
      vehicleId: id,
      blobUrl: `https://picsum.photos/seed/${id.slice(0, 8)}-${i}/1200/800`,
      blobPathname: `seed/${id}/${i}.jpg`,
      width: 1200,
      height: 800,
      bytes: 180_000,
      position: i,
      isCover: i === 0,
    })),
  );

  if (v.ownership === 'CONSIGNMENT' && 'consignment' in v && v.consignment) {
    await dbAdmin.insert(s.consignments).values({
      vehicleId: id,
      agencyId,
      consignorName: v.consignment.name,
      consignorPhone: '+54 9 11 4000-0000',
      agreedFloorAmountCents: usd(v.consignment.floorUsd),
      agreedFloorCurrency: 'USD',
      agreedFloorFxRate: v.rate,
      agreedFloorAmountBaseCents: toBase(v.consignment.floorUsd),
      commissionType: v.consignment.type,
      commissionValue: v.consignment.value,
      contractStartsAt: acquiredAt.toISOString().slice(0, 10),
    });
  } else {
    await dbAdmin.insert(s.vehicleAcquisitions).values({
      vehicleId: id,
      agencyId,
      type: 'PURCHASE',
      valueAmountCents: usd(v.buyUsd),
      valueCurrency: 'USD',
      valueFxRate: v.rate,
      valueAmountBaseCents: toBase(v.buyUsd),
      counterparty: 'Particular',
      occurredAt: acquiredAt,
      createdBy: actorId,
    });
  }

  for (const [i, c] of v.costs.entries()) {
    await dbAdmin.insert(s.vehicleCosts).values({
      agencyId,
      vehicleId: id,
      category: c.category,
      description: c.label,
      // Los gastos de taller se facturan en pesos aunque el auto se opere en USD.
      valueAmountCents: usd(c.usd * Number(ARS_PER_USD)),
      valueCurrency: 'ARS',
      valueFxRate: ARS_PER_USD,
      valueAmountBaseCents: toBase(c.usd),
      supplier: c.category === 'MECHANICAL' ? 'Taller Rivas' : 'Proveedor local',
      occurredAt: daysAgo(v.ageDays - 1 - i),
      createdBy: actorId,
    });
  }

  if (v.sale && soldAt) {
    await dbAdmin.insert(s.vehicleSales).values({
      vehicleId: id,
      agencyId,
      valueAmountCents: usd(v.sale.usd),
      valueCurrency: 'USD',
      valueFxRate: v.rate,
      valueAmountBaseCents: toBase(v.sale.usd),
      buyer: { name: 'Comprador de prueba', doc: '30.111.222' },
      paymentMethod: 'Transferencia',
      salespersonUserId: salesId,
      soldAt,
    });
  }

  await dbAdmin.insert(s.vehicleEvents).values([
    {
      agencyId,
      vehicleId: id,
      type: 'VEHICLE_CREATED',
      actorUserId: actorId,
      source: 'SYSTEM',
      occurredAt: acquiredAt,
      payload: { ownership: v.ownership },
    },
    {
      agencyId,
      vehicleId: id,
      type: 'STATUS_CHANGED',
      actorUserId: actorId,
      source: 'SYSTEM',
      occurredAt: daysAgo(Math.max(0, v.ageDays - 2)),
      payload: { from: 'INGRESADO', to: v.status },
    },
  ]);

  if (v.status === 'PUBLICADO' || v.status === 'RESERVADO') {
    const [lead] = await dbAdmin
      .insert(s.leads)
      .values({
        agencyId,
        vehicleId: id,
        name: 'Consulta web',
        email: 'interesado@example.com',
        phone: '+54 9 11 3000-1111',
        message: `Hola, me interesa el ${v.brand} ${v.model}. ¿Aceptan permuta?`,
        source: 'PUBLIC_SITE',
        status: 'NEW',
        assignedTo: salesId,
      })
      .returning();

    await dbAdmin.insert(s.appointments).values({
      agencyId,
      vehicleId: id,
      leadId: lead!.id,
      type: 'VISIT',
      status: 'SCHEDULED',
      startsAt: new Date(Date.now() + 2 * 86_400_000),
      endsAt: new Date(Date.now() + 2 * 86_400_000 + 3_600_000),
      assignedTo: salesId,
    });
  }
}

/** Patente ficticia estable. Usa la cola aleatoria del UUIDv7: el prefijo
 *  es el timestamp y dos autos creados en el mismo ms lo comparten. */
function plate(id: string) {
  const tail = id.replace(/-/g, '').slice(-12).toUpperCase();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const letter = (i: number) => alphabet[parseInt(tail[i]!, 16) % alphabet.length]!;
  const digits = String(parseInt(tail.slice(6), 16) % 1000).padStart(3, '0');
  return `${letter(0)}${letter(1)}${digits}${letter(2)}${letter(3)}`;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
