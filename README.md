# Cuasar

Plataforma de gestión para concesionarios automotrices. Stock, trazabilidad,
contabilidad por unidad, agenda, sitio público por agencia y panel de plataforma.

El diseño completo —arquitectura, modelo de datos, decisiones y riesgos— está en
[`DESIGN.md`](./DESIGN.md). **Leerlo antes de tocar código.**

## Estado

| Fase | Qué incluye | Estado |
|---|---|---|
| 0 | Monorepo, esquema de datos, RLS, dominio puro | ✅ |
| 1 | Núcleo de vehículos (CRUD, fotos, estados, timeline) | pendiente |
| 2 | Contabilidad y dashboard | pendiente |
| 3 | Sitio público multi-tenant | pendiente |
| 4 | Agenda y leads | pendiente |
| 5 | Suscripciones (Stripe → MercadoPago) y panel de plataforma | pendiente |
| 6 | Endurecimiento y performance medida | pendiente |

## Estructura

```
apps/
  app/       Backoffice de agencia + panel de plataforma  (app.cuasar.app :3000)
  public/    Sitio público multi-tenant                   (*.cuasar.app   :3001)
packages/
  db/        Esquema Drizzle, migraciones, RLS, triggers, seed
  core/      Dominio puro: estados, contabilidad, permisos, entitlements, puertos
  ui/        Design system compartido
  config/    tsconfig base
```

## Arranque

```bash
pnpm install
vercel env pull            # Neon, Clerk y Blob ya están aprovisionados
pnpm db:migrate            # DDL + roles + RLS + triggers (idempotente)
pnpm db:seed               # dos agencias con moneda base distinta
pnpm dev
```

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Levanta backoffice (:3000) y sitio público (:3001) |
| `pnpm test` | Dominio (sin DB) + aislamiento entre tenants (con DB) |
| `pnpm typecheck` | Todo el workspace |
| `pnpm db:generate` | Genera la migración a partir del esquema Drizzle |
| `pnpm db:migrate` | Aplica migraciones, roles, políticas RLS y triggers |
| `pnpm db:seed` | Datos de prueba con forma realista |
| `pnpm db:studio` | Drizzle Studio |

## Lo que hay que entender antes de escribir un query

**Ningún acceso a datos de una agencia se hace con `dbAdmin`.** Va por
`withTenant(ctx, ...)`, que abre la transacción, setea el contexto y baja
privilegios a `app_tenant` — un rol que no es dueño de las tablas y por lo tanto
sí queda sujeto a RLS. Aunque el query se olvide del `where agency_id`, Postgres
no devuelve filas de otro tenant. `dbAdmin` es solo para migraciones, seeds,
webhooks de cobro y el worker de outbox.

```ts
// bien
const stock = await withTenant(ctx, (tx) =>
  tx.select().from(vehicles).where(eq(vehicles.status, 'PUBLICADO')),
);

// mal: bypassea RLS
const stock = await dbAdmin.select().from(vehicles);
```

`packages/db/tests/isolation.test.ts` intenta cruzar ese muro a propósito, en 19
formas distintas. Si alguno de esos tests empieza a pasar cuando debería fallar,
hay una fuga de datos entre clientes. Corren en CI en cada PR.

**El timeline es append-only.** `vehicle_events` y `audit_log` no aceptan UPDATE
ni DELETE del rol de aplicación. Un cambio de estado y su evento se escriben en
la misma transacción: si el evento falla, el cambio no ocurrió.

**La plata nunca es un float.** Enteros en centavos, con moneda y con la
cotización congelada al momento del registro (`packages/core/src/money.ts`).
Cada agencia tiene su propia moneda base; `amount_base_cents` está expresado en
la base *de esa agencia*, así que ningún agregado cruza agencias sin una
conversión explícita.

**Propio y consignación no se calculan igual.** En un auto propio el resultado es
venta − compra − gastos. En consignación el capital es de un tercero: el
resultado es la comisión menos lo que la agencia puso. Mezclarlos da números que
parecen correctos y no lo son. Ver `packages/core/src/accounting.ts`.

## Servicios

| Servicio | Para qué | Estado |
|---|---|---|
| Neon Postgres (gru1) | Base de datos | ✅ aprovisionado |
| Clerk | Auth + Organizations = agencias | ✅ aprovisionado |
| Vercel Blob | Fotos de vehículos | ✅ aprovisionado |
| Upstash Redis | Cache de agregados, rate limit | Fase 3 |
| Edge Config | Mapa host → agencia | Fase 3 |
| Stripe / MercadoPago | Suscripciones | Fase 5 |
