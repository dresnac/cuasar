# Cuasar

Plataforma de gestión para concesionarios automotrices. Stock, trazabilidad,
contabilidad por unidad, agenda, sitio público por agencia y panel de plataforma.

El diseño completo —arquitectura, modelo de datos, decisiones y riesgos— está en
[`DESIGN.md`](./DESIGN.md). **Leerlo antes de tocar código.**

## Estado

| Fase | Qué incluye | Estado |
|---|---|---|
| 0 | Monorepo, esquema de datos, RLS, dominio puro | ✅ |
| 1 | Núcleo de vehículos (CRUD, fotos, estados, timeline) | ✅ |
| 2 | Contabilidad y dashboard | ✅ |
| 3 | Sitio público multi-tenant | ✅ |
| 4 | Agenda y leads | ✅ |
| 5 | Suscripciones y panel de plataforma | ✅ (falta conectar los proveedores) |
| 6 | Endurecimiento y performance medida | pendiente |

## Estructura

```
apps/
  app/       Backoffice de agencia + panel de plataforma  (app.cuasar.app :3000)
  public/    Sitio público multi-tenant                   (*.cuasar.app   :3001)
packages/
  db/            Esquema Drizzle, migraciones, RLS, triggers, seed
  core/          Dominio: estados, contabilidad, permisos, entitlements, servicios
  integrations/  Adapters de terceros y el worker de la cola de salida
  ui/            Design system compartido
  config/        tsconfig base
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
| `pnpm db:make-admin <email>` | Da de alta un moderador de plataforma |

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

**Clerk resuelve identidad, no tenencia.** La agencia activa, el rol y los
asientos salen de `memberships`, no de Clerk. Las políticas RLS y la matriz de
permisos dependen de esa tabla, así que tiene que ser la única autoridad: dos
fuentes de verdad sobre quién pertenece a qué es cómo se produce una fuga.

**Dos trampas de Drizzle que ya nos costaron caro.** En un fragmento `sql` dentro
de un `select`: (1) poné siempre `.as('nombre')`, y (2) escribí la columna externa
calificada a mano (`"vehicles"."id"`), porque interpolar `${vehicles.id}` la
renderiza como `"id"` a secas y adentro de un subselect eso resuelve a la tabla
interna — la consulta no falla, contesta cero. Además, un fragmento crudo no
lleva el tipo de la columna: un `bigint` vuelve como string. Para plata, seleccioná
columnas reales y hacé la cuenta en TypeScript.

**El timeline es append-only.** `vehicle_events` y `audit_log` no aceptan UPDATE
ni DELETE del rol de aplicación. Un cambio de estado y su evento se escriben en
la misma transacción: si el evento falla, el cambio no ocurrió.

**La plata nunca es un float.** Enteros en centavos, con moneda y con la
cotización congelada al momento del registro (`packages/core/src/money.ts`).
Cada agencia tiene su propia moneda base; `amount_base_cents` está expresado en
la base *de esa agencia*, así que ningún agregado cruza agencias sin una
conversión explícita.

**`subscriptions` es una proyección, nunca la fuente de verdad.** La escriben
los webhooks; ninguna agencia puede tocarla (el rol `app_tenant` tiene revocado
el insert y el update). Todo evento de cobro se reserva por
`(provider, provider_event_id)` antes de aplicarse, y se distingue un reintento
de algo ya procesado de un reintento de algo que se registró pero nunca se
llegó a aplicar: descartar el segundo dejaría la suscripción desincronizada
para siempre.

**Nada sale al mundo desde adentro de un request.** Un mail, una publicación
en MercadoLibre o un evento de calendario se encolan en `outbox` dentro de la
misma transacción que el cambio, y un worker los drena
(`/api/cron/outbox-drain`, cada cinco minutos). Mandar el mail adentro del
request es peor de las dos maneras: si el proveedor no contesta, el usuario ve
un error y el cambio quedó a medias. El payload guarda solo ids —los datos se
buscan al momento de enviar— así que una consulta anonimizada entre medio no
termina filtrada en el mail.

**El sitio público corre con un rol propio que casi no puede nada.**
`withPublicAgency` baja a `app_public`, que solo lee `vehicle_public_view`,
`agencies` y `agency_settings`, y solo escribe leads y eventos. No alcanza la
tabla `vehicles` —donde vive el precio de compra— ni puede releer las consultas
que él mismo deja. Es la única parte del sistema expuesta a internet sin
autenticación, así que sus privilegios se definen por lo que necesita.

**Vender y registrar la venta son el mismo acto.** `registerSale` inserta la fila
en `vehicle_sales` y mueve el estado a `VENDIDO` en una sola transacción, y la UI
no ofrece `VENDIDO` como transición suelta: un vehículo vendido sin fila de venta
sería un agujero silencioso en la contabilidad.

**Nunca convertir moneda sin cotización.** Si la operación viene en una moneda
distinta a la base de la agencia y no hay `fxRate`, la acción falla. Tomar 1 por
defecto metería un monto en pesos en una contabilidad en dólares y el error
recién aparecería meses después, en un margen que no cierra.

**Propio y consignación no se calculan igual.** En un auto propio el resultado es
venta − compra − gastos. En consignación el capital es de un tercero: el
resultado es la comisión menos lo que la agencia puso. Mezclarlos da números que
parecen correctos y no lo son. Ver `packages/core/src/accounting.ts`.

## Servicios

| Servicio | Para qué | Estado |
|---|---|---|
| Neon Postgres (gru1) | Base de datos | ✅ aprovisionado |
| Clerk | Identidad (sign-in, cuentas) | ✅ aprovisionado |
| Vercel Blob | Fotos de vehículos | ✅ aprovisionado |
| Resend | Mails de aviso | pendiente: necesita un dominio verificado |
| Stripe | Cobro con tarjeta | pendiente: hay que aceptar los términos en el navegador |
| MercadoPago | Cobro local en ARS | pendiente: credenciales de la cuenta |
| Upstash Redis | Rate limit distribuido | cuando haga falta |
| Stripe / MercadoPago | Suscripciones | Fase 5 |
