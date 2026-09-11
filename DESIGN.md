# DESIGN.md — Plataforma de gestión para concesionarios ("Cuasar")

SaaS multi-tenant para agencias automotrices: gestión de stock, trazabilidad, contabilidad por unidad, agenda, sitio público por agencia y panel de plataforma.

---

## 1. Qué construimos

### Objetivo
Una plataforma donde cada agencia gestiona su flota (propia y en consignación), registra cada acción y cada peso gastado sobre un vehículo, ve su rentabilidad en un dashboard, agenda visitas, y publica automáticamente su catálogo en un sitio público propio. La plataforma se cobra por suscripción mensual (USD 100/agencia) con múltiples usuarios por cuenta.

### Actores
| Actor | Dónde opera | Qué hace |
|---|---|---|
| Visitante | Sitio público de la agencia | Ve catálogo, filtra, consulta, pide turno |
| Vendedor | Backoffice | Carga/edita vehículos, registra acciones y gastos, atiende leads, agenda |
| Admin de agencia | Backoffice | Todo lo anterior + usuarios, precios, contabilidad, branding, suscripción |
| Moderador de plataforma | Panel interno | Alta/baja de agencias, métricas globales, soporte. **Sin acceso operativo a las agencias** (salvo impersonación auditada) |

### Dentro del scope (v1)
Stock y ficha de vehículo · timeline de acciones y días en agencia · propio vs. consignación · costos y contabilidad por unidad · dashboard contable · multi-usuario y multi-agencia · sitio público por agencia con formulario de contacto · calendario de turnos · panel de plataforma · suscripciones con Stripe · capa de integraciones preparada (sin conectar).

### Fuera del scope (v1)
- Integración real con MercadoLibre / Google Calendar (solo **se deja la capa lista**, ver §6).
- Facturación fiscal AFIP / e-factura.
- App móvil nativa (el backoffice es responsive).
- Gestión de taller/service como módulo propio (los trabajos entran como *costos* del vehículo).
- Firma digital de documentación y checking de dominio/prendas.
- Mercado de cambio propio: no cotizamos ni actualizamos el dólar automáticamente en v1; el `fx_rate` lo fija la agencia (con un valor sugerido editable).

---

## 2. Arquitectura

### Forma general
Monorepo Turborepo, TypeScript de punta a punta, desplegado en Vercel. Postgres es el centro del sistema; todo lo demás es una capa fina alrededor.

```
                    ┌──────────────────────────────┐
   visitante  ──▶   │ apps/public   (*.cuasar.app  │
                    │  + dominios propios)         │──┐
                    │  ISR/PPR, casi todo cacheado │  │
                    └──────────────────────────────┘  │
                                                      │   lectura cacheada
   agencia    ──▶   ┌──────────────────────────────┐  │
                    │ apps/app  (app.cuasar.app)   │  │
                    │  backoffice + /platform      │──┼──▶ ┌──────────────┐
                    │  RSC + Server Actions        │  │    │  Neon        │
                    └──────────────────────────────┘  │    │  Postgres    │
                                                      │    │  (RLS por    │
   Stripe/webhooks ▶ ┌─────────────────────────────┐  │    │   agency_id) │
   crons/queues    ▶ │ route handlers + workers    │──┘    └──────┬───────┘
                     └─────────────────────────────┘              │
                                                                  │
     Vercel Blob (imágenes)  ·  Upstash Redis (cache/rate-limit)  ·  outbox → integraciones
```

### Apps y paquetes
```
apps/
  app/        Backoffice de agencia + panel de plataforma (/platform, role-gated)
  public/     Sitio público multi-tenant (wildcard + dominios custom)
packages/
  db/         Esquema Drizzle, migraciones, políticas RLS, seeds
  core/       Lógica de dominio pura: estados, timeline, contabilidad, cuotas
  integrations/ Puertos + adapters (listings, calendar) + outbox worker
  ui/         Design system compartido (shadcn/ui + Tailwind)
  config/     tsconfig, eslint, tailwind preset
```

**Por qué dos apps y no una:** el sitio público y el backoffice tienen perfiles de caché opuestos. El público debe ser estático/ISR y servirse desde CDN sin tocar la DB en el 95% de los requests; el backoffice es dinámico y autenticado. Separarlos permite que un pico de tráfico público (una publicación viral, un bot de scraping) no degrade el backoffice, y que cada uno escale y se despliegue por su cuenta.

### Resolución de tenant
- **Público:** `proxy.ts` lee el `Host` → resuelve `host → agency_id` contra un mapa en memoria del proceso con TTL de 5 minutos (los hosts desconocidos también se cachean, para que un dominio inventado no dispare una consulta) → inyecta el header `x-agency-id` → las rutas renderizan con `cacheTag('catalogo:<id>')`. Resolverlo en el proxy y no en la página también es lo que permite contestar un 404 real: con prerender parcial el estado ya viajó cuando la parte dinámica descubriría que no hay agencia.
- **Backoffice:** el tenant sale de la sesión (organización activa), nunca de la URL.

### Modelo multi-tenant
**Una sola base, `agency_id` en toda tabla de negocio, aislado por Row-Level Security.** Cada request abre la conexión seteando `SET LOCAL app.agency_id` y `app.role`; las políticas RLS filtran. La app nunca es la única línea de defensa: aunque un query olvide el `WHERE agency_id`, Postgres no devuelve filas de otro tenant.

*Por qué no una DB por agencia:* a USD 100/mes el costo operativo (migraciones × N, N pools de conexión, N backups) se come el margen, y las métricas globales del panel de plataforma requerirían fan-out. RLS da el aislamiento que necesitamos con una sola superficie operativa. Si más adelante una agencia grande necesita aislamiento físico, el esquema ya está particionado por `agency_id` y se puede extraer.

### Estrategia de performance (requisito prioritario)
1. **Índices compuestos con `agency_id` como primera columna** en toda tabla — todo query real ya filtra por tenant.
2. **Vista denormalizada de catálogo** (`vehicle_public_view`, tabla materializada por trigger): una fila por vehículo publicado con todo lo que el sitio público necesita, incluidas las 3 primeras imágenes en JSONB. El listado público es **un solo SELECT sin joins**.
3. **Imágenes fuera de la DB**: en Postgres solo la URL y metadata. Originales en Vercel Blob, servidos vía `next/image` con AVIF/WebP y `sizes` correctos.
4. **Caché en capas**: CDN/ISR para el público (invalidado por `cacheTag` al publicar), Redis para agregados del dashboard y rate-limiting, y `React.cache` por request.
5. **Agregados contables precalculados**: `vehicle_financials` se mantiene por trigger en cada costo/venta. El dashboard no hace `SUM()` sobre miles de filas en vivo.
6. **Paginación por keyset** (no `OFFSET`) en listados largos.

---

## 3. Estados y ciclo de vida del vehículo

```
  INGRESADO ──▶ EN_PREPARACION ──▶ PUBLICADO ──▶ RESERVADO ──▶ VENDIDO
      │                │               │             │
      └────────────────┴───────────────┴─────────────┴──▶ PAUSADO
                                                     └──▶ DEVUELTO  (solo consignación)
                                                     └──▶ BAJA
```

- El estado vive en `vehicles.status`, pero **cada transición genera un evento** en `vehicle_events`. El timeline es la fuente de verdad histórica; el campo `status` es la proyección para queries rápidas.
- Transiciones válidas declaradas en `packages/core/vehicle-state.ts`; una transición inválida es un error de dominio, no un update silencioso.
- `PUBLICADO` es lo único que aparece en el sitio público.

### Tiempo en agencia
`acquired_at` se fija al ingreso. Se derivan:
- **Días en stock** = `now - acquired_at` (o `sold_at - acquired_at` si está vendido).
- **Días en el estado actual** = `now - status_changed_at`.
- **Tiempo por estado**, reconstruible del timeline → alimenta la métrica "cuánto tarda cada etapa".
Todo calculado en columnas generadas/SQL, nunca en el cliente.

### Trazabilidad
`vehicle_events` es **append-only, sin update ni delete** (revocado por permisos de DB). Registra: ingreso, cambio de estado, cambio de precio (con valor anterior y nuevo), carga/baja de fotos, costo registrado, lead recibido, turno agendado, publicación, venta, y toda edición de la ficha (diff en JSONB). Cada evento guarda `actor_user_id`, `source` (`web` | `api` | `system` | `integration`) y `occurred_at`.

---

## 4. Modelo de datos

Postgres 16 (Neon). Drizzle ORM. Todos los IDs son UUIDv7 (ordenables en el tiempo → mejor localidad de índice). Toda tabla de negocio: `agency_id`, `created_at`, `updated_at`.

### Tenancy y accesos
```
agencies            id · name · slug · status(ACTIVE|SUSPENDED|CANCELLED) · timezone
                    · base_currency(default USD) · created_at
agency_settings     agency_id · branding(jsonb: logo, colores, fuentes) · contact · social
                    · public_domain · seo(jsonb)
users               id · email · name · avatar_url          (espejo del proveedor de identidad)
memberships         agency_id · user_id · role(OWNER|ADMIN|SALES|VIEWER) · status
                    UNIQUE(agency_id, user_id)
platform_admins     user_id · level(SUPPORT|ADMIN)          (fuera del modelo de tenancy)
audit_log           actor · action · target · payload · ip  (append-only, incluye impersonación)
```

### Vehículos
```
vehicles
  id · agency_id · vin · license_plate · brand · model · version · year
  km · fuel · transmission · color · doors
  ownership(OWNED|CONSIGNMENT) · status · status_changed_at
  acquired_at · sold_at · published_at
  list_price_amount · list_price_currency          (precio de venta publicado)
  description · features(jsonb) · slug
  UNIQUE(agency_id, license_plate)  ·  UNIQUE(agency_id, slug)

vehicle_images      id · agency_id · vehicle_id · blob_url · width · height
                    · blur_data_url · position · is_cover
vehicle_events      id · agency_id · vehicle_id · type · actor_user_id · source
                    · payload(jsonb) · occurred_at        ← APPEND-ONLY
consignments        vehicle_id · agency_id · consignor_name · consignor_doc · consignor_phone
                    · agreed_floor_price · commission_type(PCT|FIXED) · commission_value
                    · contract_starts_at · contract_ends_at · settled_at
```

**Propio vs. consignación.** `ownership` no es solo una etiqueta: cambia la contabilidad. En `OWNED` el resultado es `venta − compra − gastos`. En `CONSIGNMENT` el costo de adquisición **no es de la agencia**: el resultado es `comisión − gastos asumidos por la agencia`. La capa contable (`packages/core/accounting.ts`) resuelve por `ownership`; los dashboards separan ambos flujos porque mezclarlos distorsiona el capital inmovilizado.

### Dinero
Cada agencia define su **moneda base** (`agencies.base_currency`, USD por defecto). Toda plata se guarda como `amount_cents BIGINT` + `currency CHAR(3)` + `fx_rate NUMERIC` + `amount_base_cents` (convertido a la base de *esa* agencia al momento del registro). Nunca `float`. Nunca un monto sin moneda.

El `fx_rate` se congela en la transacción y **no se recalcula nunca**: un margen histórico tiene que seguir dando lo mismo dentro de dos años. Los reportes globales del panel de plataforma consolidan a USD con un `fx` de referencia propio y lo declaran en pantalla, porque sumar bases distintas sin decirlo es exactamente cómo se producen números falsos.

```
vehicle_acquisitions  vehicle_id · type(PURCHASE|TRADE_IN|CONSIGNMENT) · amount · currency
                      · fx_rate · occurred_at · counterparty · notes
vehicle_costs         id · agency_id · vehicle_id · category(MECHANICAL|BODYWORK|DETAILING|
                      PAPERWORK|TRANSPORT|MARKETING|OTHER) · amount · currency · fx_rate
                      · supplier · invoice_ref · occurred_at · created_by
vehicle_sales         vehicle_id · amount · currency · fx_rate · buyer(jsonb)
                      · payment_method · sold_at · salesperson_user_id
vehicle_financials    vehicle_id (PK) · acquisition_base · costs_base · sale_base
                      · commission_base · gross_margin_base · margin_pct · days_in_stock
                      ← proyección mantenida por trigger; es lo que lee el dashboard
```

### Comercial
```
leads          id · agency_id · vehicle_id? · name · email · phone · message
               · source(PUBLIC_SITE|WHATSAPP|MELI|MANUAL) · status(NEW|CONTACTED|QUALIFIED|
               WON|LOST) · assigned_to · created_at
appointments   id · agency_id · vehicle_id? · lead_id? · type(VISIT|TEST_DRIVE|DELIVERY|
               APPRAISAL) · starts_at · ends_at · status(SCHEDULED|CONFIRMED|DONE|NO_SHOW|
               CANCELLED) · assigned_to · notes · external_ref(jsonb)
availability   agency_id · user_id? · weekday · from · to     (horarios de atención)
```

### Suscripciones
```
plans           code · name · price_cents · currency · included_seats(5)
                · extra_seat_price_cents · vehicle_limit · features(jsonb)
subscriptions   agency_id · plan_code · status(TRIALING|ACTIVE|PAST_DUE|CANCELLED)
                · provider(STRIPE|MERCADOPAGO) · provider_customer_id
                · provider_subscription_id · current_period_end
                · seats_purchased · cancel_at_period_end
                UNIQUE(agency_id) WHERE status <> 'CANCELLED'
invoices        agency_id · provider · provider_invoice_id · amount · currency
                · status · issued_at · pdf_url
billing_events  agency_id · provider · provider_event_id · type · payload(jsonb)
                · processed_at    UNIQUE(provider, provider_event_id)  ← idempotencia
```

**Asientos.** El plan base son **USD 100/mes con 5 usuarios incluidos**; el sexto y siguientes se cobran como asiento adicional. `seats_purchased` es lo facturado; `included_seats` viene del plan. El límite efectivo es `max(included_seats, seats_purchased)` y se valida en la invitación y en el login (§6).

### Integraciones (preparado, no conectado)
```
integration_connections  agency_id · provider(MELI|GOOGLE_CALENDAR|...) · status
                         · credentials(cifrado) · scopes · connected_at
integration_links        agency_id · provider · local_type · local_id · remote_id
                         · last_synced_at · sync_state      ← mapeo bidireccional
outbox                   id · agency_id · topic · payload(jsonb) · status · attempts
                         · next_attempt_at    ← toda escritura que deba salir al mundo
```

### Índices principales
```
vehicles           (agency_id, status, updated_at DESC) · (agency_id, ownership, status)
                   (agency_id, brand, model) · GIN sobre búsqueda de texto
vehicle_events     (agency_id, vehicle_id, occurred_at DESC)
vehicle_costs      (agency_id, vehicle_id) · (agency_id, occurred_at)
appointments       (agency_id, starts_at) · (agency_id, assigned_to, starts_at)
leads              (agency_id, status, created_at DESC)
vehicle_public_view (agency_id, published_at DESC) · (agency_id, price_base)
outbox             (status, next_attempt_at)
```

---

## 5. Interfaces y contratos

### Capas
```
UI (RSC / Client Components)
   ↓  Server Actions (mutaciones)  ·  Route Handlers (webhooks, API pública futura)
Servicios de dominio  (packages/core)   ← valida permisos, transiciones, contabilidad
   ↓
Repositorios (packages/db)              ← únicos que hablan SQL; siempre con tenant context
   ↓
Postgres + RLS
```
Regla: **ningún componente de UI hace SQL**, y **ningún servicio de dominio conoce React**. Una mutación siempre pasa por un servicio, que es quien escribe el evento en el timeline en la misma transacción que el cambio.

### Contrato de mutación
```ts
type Ctx = { agencyId: string; userId: string; role: Role; requestId: string };
type Result<T> = { ok: true; data: T } | { ok: false; error: DomainError };

// packages/core/vehicles.ts
publishVehicle(ctx: Ctx, vehicleId: string): Promise<Result<Vehicle>>
registerCost(ctx: Ctx, input: RegisterCostInput): Promise<Result<VehicleCost>>
transitionStatus(ctx: Ctx, vehicleId, to: VehicleStatus, meta?): Promise<Result<Vehicle>>
```
Toda entrada validada con Zod en el borde. Los errores de dominio son valores tipados, no excepciones — la UI muestra mensajes, no stack traces.

**Invariante transaccional:** cambio de estado + evento de timeline + actualización de la proyección ocurren en **una** transacción. Si el timeline falla, el cambio no ocurrió.

### Superficies HTTP
```
POST /api/webhooks/stripe         firma verificada · idempotente por event.id
POST /api/webhooks/mercadopago    firma verificada · idempotente por event.id
POST /api/public/leads            desde el sitio público · rate-limited · BotID + honeypot
GET  /api/public/vehicles         JSON cacheado del catálogo (para futuro headless)
GET  /api/cron/outbox-drain       worker de integraciones
GET  /api/cron/subscriptions-check
GET  /sitemap.xml · /robots.txt   por tenant
```

### Puertos de integración (v1 define la interfaz, no la implementa)
```ts
interface ListingPort {            // MercadoLibre y similares
  publish(ctx, vehicle): Promise<RemoteRef>;
  update(ctx, ref, vehicle): Promise<void>;
  unpublish(ctx, ref): Promise<void>;
  pullLeads(ctx, since): Promise<Lead[]>;
}
interface CalendarPort {           // Google Calendar y similares
  push(ctx, appointment): Promise<RemoteRef>;
  cancel(ctx, ref): Promise<void>;
  pullBusy(ctx, range): Promise<BusySlot[]>;
}

interface BillingPort {            // Stripe y MercadoPago detrás de la misma interfaz
  createSubscription(agency, plan, seats): Promise<ProviderSubscription>;
  updateSeats(ref, seats): Promise<void>;
  cancel(ref, atPeriodEnd: boolean): Promise<void>;
  portalUrl(ref): Promise<string>;          // MercadoPago: pantalla propia
  parseWebhook(req): Promise<BillingEvent>; // normaliza a un evento común
}
```

Los webhooks de ambos proveedores se normalizan a un **mismo set de eventos de dominio** (`subscription.activated`, `.past_due`, `.cancelled`, `.seats_changed`). El resto del sistema — `entitlements`, el panel de plataforma, el modo lectura — no sabe qué proveedor cobró.
Nada del dominio importa un SDK de tercero: el dominio escribe en `outbox`, un worker lo drena y llama al adapter. Conectar MercadoLibre en el futuro = escribir un adapter + una pantalla de OAuth, sin tocar el core.

---

## 6. Decisiones técnicas

| Decisión | Elección | Por qué |
|---|---|---|
| Framework | **Next.js 16 (App Router), React Server Components** | Un solo stack para público (estático/ISR) y backoffice (dinámico). PPR permite cachear el shell del catálogo y streamear solo lo dinámico. |
| Hosting | **Vercel, Fluid Compute (Node.js)** | Dominios wildcard + custom por tenant, ISR con invalidación por tag, y crons sin infraestructura aparte. |
| Base de datos | **Neon Postgres** (Marketplace) | El requisito es "construido en torno a la DB": Postgres relacional da integridad transaccional sobre plata y estados, JSONB donde hace falta flexibilidad, y RLS como muro de tenancy. Neon suma branching por preview y escalado a cero. |
| ORM | **Drizzle** | SQL explícito y tipado; no esconde el plan de ejecución. Con foco en performance, no queremos un ORM que genere N+1 sin que se note. |
| Imágenes | **Vercel Blob** + `next/image` | Uploads directos desde el browser (no pasan por la función), AVIF/WebP automático, CDN. La DB guarda solo metadata. |
| Caché | **PPR + `use cache` con `cacheTag`** por agencia | El catálogo se sirve prerenderizado con la parte dinámica en streaming, y se invalida por tag cuando la agencia publica. El mapa host→tenant vive en memoria del proxy, no en un store aparte: una sola fuente de verdad, y si el volumen lo pide se cambia esa función sola. Redis entra cuando haya rate-limit distribuido que justificarlo. |
| Auth | **Clerk** (Marketplace), solo identidad | Clerk resuelve sign-in, cuentas y recuperación de contraseña. **La tenencia no**: la agencia activa, el rol y los asientos salen de `memberships`. Ver la nota de abajo. |
| Pagos | **Stripe** (Marketplace) + **MercadoPago**, elegido por la agencia | Stripe resuelve tarjeta internacional, portal y dunning; MercadoPago (preapproval) es imprescindible para la agencia argentina sin tarjeta habilitada en USD. Ambos detrás de un `BillingPort` único (§5). |
| Moneda | **Base por agencia** (`base_currency`, USD por defecto) | Una agencia que opera en USD y otra que opera en pesos necesitan márgenes en su propia unidad. El `fx_rate` congelado por transacción hace que el histórico no se mueva. |
| UI | **Tailwind + shadcn/ui** | Componentes propios en el repo, sin dependencia de versión de una librería cerrada; el sitio público necesita theming por agencia. |
| Validación | **Zod** compartido cliente/servidor | Un solo esquema por entrada. |
| Testing | **Vitest** (dominio y contabilidad) + **Playwright** (flujos críticos) | La lógica de plata y transiciones se testea unitariamente; el resto, end-to-end sobre los 5 flujos que no pueden romperse. |
| Observabilidad | Vercel Analytics + Speed Insights + Sentry | El requisito de velocidad necesita medición, no intuición. |

### Por qué el mapa host→agencia no está en Edge Config

El diseño original lo ponía en Edge Config. Al implementarlo, el costo apareció
antes que el beneficio: un store aparte hay que mantenerlo sincronizado con la
base cada vez que una agencia cambia de dominio o se suspende, y un mapa que
quedó viejo sirve el sitio equivocado. Cachear la consulta en el proceso del
proxy da la misma latencia después del primer request, con una sola fuente de
verdad. `resolveAgencyByHost` es una función: si el volumen lo justifica, se
cambia ahí y el resto del sitio no se entera.

### Por qué Clerk no maneja las agencias

El diseño original mapeaba una Organization de Clerk a una agencia. Al
implementarlo apareció un problema que lo invalida: los roles de este producto
(`OWNER`/`ADMIN`/`SALES`/`VIEWER`) no existen en Clerk sin el módulo B2B pago, y
las políticas RLS y la matriz de permisos ya dependen de `memberships`. Mapear
las agencias a Organizations dejaba **dos fuentes de verdad sobre quién
pertenece a qué**, que es exactamente la forma en que se produce una fuga de
datos entre clientes.

Decisión: Clerk se queda con la identidad; `memberships` es la autoridad sobre
tenencia y permisos. `agencies.clerk_org_id` existe y es nullable, así que si más
adelante conviene habilitar Organizations —para invitaciones por mail y SSO
empresarial— el mapeo entra sin migración de datos.

Lo que esto cuesta: hay que construir el selector de agencia y el flujo de
invitaciones. El selector ya está hecho; las invitaciones caen en la Fase 5,
junto con los asientos, que es donde tienen que estar de todos modos.

### Autorización
Dos capas, sin excepción:
1. **RLS en Postgres** — aislamiento entre agencias. No hay forma de que un query filtre datos de otro tenant.
2. **Permisos por rol en el dominio** — qué puede hacer cada rol *dentro* de su agencia.

| | OWNER | ADMIN | SALES | VIEWER |
|---|---|---|---|---|
| Ficha, estado y timeline del vehículo | ✅ | ✅ | ✅ | 👁 |
| Precio de venta publicado | ✅ | ✅ | 👁 | 👁 |
| Piso de negociación | ✅ | ✅ | 👁 | — |
| **Precio de adquisición, costos y margen** | ✅ | ✅ | **—** | — |
| Dashboard contable | ✅ | ✅ | — | — |
| Leads y agenda | ✅ | ✅ | ✅ (asignados) | 👁 |
| Usuarios, branding, suscripción | ✅ | ✅ | — | — |

`SALES` **no ve** adquisición, costos ni rentabilidad: ni en la ficha, ni en la API, ni en exportaciones. No se resuelve ocultando en la UI — los servicios de dominio no devuelven esos campos para ese rol, porque una columna oculta en el front sigue viajando en el payload del RSC.

El panel de plataforma corre **fuera** del contexto de tenant, con un rol de DB distinto (`platform_reader`) que solo ve tablas agregadas y de administración. El acceso a datos operativos de una agencia requiere impersonación explícita, que deja registro en `audit_log`.

### Cuotas de suscripción
El límite de asientos (5 incluidos + los adicionales comprados) se valida en la invitación **y** en el login (una agencia que baja de plan no puede quedar con asientos de más; los excedentes se bloquean por orden inverso de alta, nunca el OWNER). Con `subscriptions.status = PAST_DUE` la plataforma entra en **modo lectura** para el backoffice tras un período de gracia configurable; con `CANCELLED`, el sitio público se despublica y los datos se retienen 90 días antes de purgarse. Esto se decide en un solo lugar (`core/entitlements.ts`), no en cada pantalla.

---

## 7. Riesgos y partes difíciles

| Riesgo | Por qué duele | Cómo lo manejamos |
|---|---|---|
| **RLS mal configurado** | Una política floja = fuga de datos entre agencias. Es el riesgo número uno del diseño. | Tests de integración que intentan explícitamente leer de otro tenant y deben fallar; se corren en CI en cada PR. Ningún acceso a DB sin contexto de tenant seteado (helper único). |
| **Volumen de imágenes** | 20–40 fotos por vehículo × miles de vehículos. Mal manejado, se come el presupuesto y la velocidad. | Upload directo a Blob con límite de tamaño y cantidad por plan, resize en el cliente antes de subir, `sizes` correctos, lazy-load. Monitoreo de egress desde el día uno. |
| **Dominios custom por agencia** | Verificación DNS, certificados, propagación — genera soporte y confusión. | v1 arranca con subdominio `agencia.cuasar.app` funcionando siempre; dominio propio es un flujo guiado, opcional, con estado de verificación visible. |
| **Precisión contable** | Un error de redondeo o de tipo de cambio destruye la confianza en el producto entero. | Enteros en centavos, `fx_rate` congelado en cada transacción, tests con casos reales de consignación, y una pantalla de conciliación que muestra el desglose de cada número del dashboard. |
| **Consignación distorsiona métricas** | Sumar autos en consignación al capital inmovilizado da números falsos. | `ownership` separa los flujos en modelo, servicios y dashboard. Toda métrica agregada declara qué incluye. |
| **Invalidación de caché del público** | Un precio desactualizado en el catálogo es un problema comercial. | Invalidación por `cacheTag` en la misma transacción de publicación; TTL de respaldo corto; el precio de la ficha se revalida on-demand. |
| **Webhooks de cobro** | Reintentos y llegada desordenada causan estados de suscripción incorrectos. | Idempotencia por `(provider, event_id)` en `billing_events`, reconciliación por cron contra la API del proveedor, y `subscriptions` como proyección, nunca como fuente de verdad. |
| **Dos proveedores de pago** | Duplica la superficie de cobro: dos modelos de webhook, dos de prorrateo, dos formas de fallar. MercadoPago además no trae portal de facturación ni dunning. | Un solo `BillingPort` con eventos normalizados; el dominio no conoce el proveedor. Stripe primero (Fase 5a), MercadoPago después (5b) sobre la interfaz ya probada. Portal de facturación propio para MercadoPago, mínimo: estado, próximo cobro, cambio de medio de pago, cancelar. |
| **Monedas base distintas por agencia** | Reportes globales que suman USD y ARS sin declararlo dan números sin sentido. | `amount_base_cents` siempre relativo a la base de su agencia; el panel de plataforma consolida con un fx de referencia propio y lo muestra en pantalla. Ningún agregado cruza agencias sin pasar por esa conversión explícita. |
| **Integraciones futuras** | Acoplar el dominio a MercadoLibre ahora obligaría a reescribir después. | Patrón puerto/adapter + outbox definido desde v1 aunque no haya adapter implementado. El costo hoy es bajo; el de no hacerlo, alto. |
| **Timeline append-only vs. GDPR/datos personales** | Los eventos guardan datos de leads que podrían tener que borrarse. | Datos personales referenciados por ID, no copiados al payload del evento; el borrado anonimiza la entidad referida. |

---

## 8. Plan de implementación

Cada fase termina desplegada y usable; no hay fase que solo produzca andamios.

**Fase 0 — Cimientos (la DB primero)**
Monorepo, Neon aprovisionado, esquema Drizzle completo con RLS y sus tests de aislamiento, Clerk con Organizations, seeds realistas. Sin UI todavía: si el modelo de datos está mal, todo lo demás se reescribe.

**Fase 1 — Núcleo de vehículos**
CRUD de vehículos, upload de imágenes a Blob, máquina de estados, timeline de eventos, propio/consignación, listado con filtros y búsqueda. Es el corazón del producto.

**Fase 2 — Plata**
Adquisiciones, costos, ventas, proyección `vehicle_financials`, dashboard contable (margen por unidad, por período, por vendedor, capital inmovilizado, días en stock, rotación).

**Fase 3 — Sitio público**
App pública multi-tenant, routing por host vía Edge Config, catálogo y ficha con ISR, branding por agencia, formulario de contacto → leads, SEO y sitemap por tenant.

**Fase 4 — Agenda y leads**
Calendario de turnos, disponibilidad, bandeja de leads con asignación y estados, notificaciones por email.

**Fase 5a — Suscripciones (Stripe)**
`BillingPort`, plan de USD 100 con 5 asientos incluidos y asiento adicional, `entitlements`, modo lectura por `PAST_DUE`, portal de facturación.

**Fase 5b — MercadoPago**
Segundo adapter sobre el mismo puerto, elección de proveedor en el alta de la agencia, portal de facturación propio.

**Fase 5c — Panel de plataforma**
Moderadores, métricas globales (consolidadas a USD y declaradas como tales), alta/baja y suspensión de agencias, audit log e impersonación.

**Fase 6 — Endurecimiento**
Presupuesto de performance medido (objetivo: catálogo público LCP < 1.5s, backoffice TTI < 2s), rate limiting, BotID en formularios, backups y restore probado, Sentry, documentación de operación.

---

## 9. Decisiones confirmadas

| # | Decisión | Resuelto |
|---|---|---|
| 1 | Moneda | **Base configurable por agencia**, USD por defecto. `fx_rate` congelado por transacción; reportes de plataforma consolidados a USD y declarados. |
| 2 | Cobro | **Stripe y MercadoPago, elige la agencia.** Un solo `BillingPort`; Stripe en Fase 5a, MercadoPago en 5b. |
| 3 | Asientos | **USD 100/mes con 5 usuarios incluidos**, asiento adicional con cargo. |
| 4 | Roles | **`SALES` no ve adquisición, costos ni márgenes** — filtrado en el servicio de dominio, no en la UI. |

| 5 | Dominio | **cuasar.app**. Subdominio por agencia (`<slug>.cuasar.app`) siempre activo; dominio propio es un flujo opcional verificado. |

Diseño aprobado el 2026-09-11. La implementación arranca por la Fase 0 (§8).
