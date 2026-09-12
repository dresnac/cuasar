# Operación

Qué hacer cuando algo se rompe, y qué se verificó de esto y qué no.

Lo marcado **verificado** se probó en esta máquina contra la base real.
Lo marcado **sin probar** está escrito pero nadie lo ejecutó todavía; tratarlo
como una hipótesis, no como un procedimiento.

---

## Presupuesto de performance

```bash
pnpm db:perf --bench     # genera volumen, mide, y limpia
pnpm db:perf             # rápido, contra el seed (no significa mucho)
```

**Verificado.** `--bench` crea 40 agencias con 250 vehículos cada una —10.000
unidades, 60.000 fotos, 80.000 eventos— mide las ocho consultas calientes y
falla si alguna se pasa de su presupuesto o cae a scan secuencial.

Última corrida, todas dentro de presupuesto:

| Consulta | Tiempo | Presupuesto |
|---|---|---|
| catálogo público · listado | 0,22 ms | 25 ms |
| catálogo público · filtrado por marca y precio | 0,12 ms | 25 ms |
| backoffice · listado de stock | 0,89 ms | 40 ms |
| backoffice · timeline de un vehículo | 0,12 ms | 25 ms |
| dashboard · cartera y capital inmovilizado | 0,51 ms | 40 ms |
| dashboard · margen por mes | 0,52 ms | 40 ms |
| bandeja de consultas | 0,20 ms | 25 ms |
| agenda de la semana | 0,05 ms | 25 ms |

**Por qué el benchmark crea muchas agencias y no una sola grande.** La forma
real de esta plataforma es una tabla con miles de filas repartidas entre
decenas de inquilinos. Con todo el volumen en una sola agencia el filtro por
`agency_id` no es selectivo, Postgres elige scan secuencial con razón, y el
presupuesto mide un plan que nunca va a correr en producción. La primera
versión del benchmark tenía ese error y "encontró" tres problemas que no
existían — además de uno que sí: faltaba el índice `(agency_id, created_at)`,
que es el orden por defecto del listado de stock.

**Lo que esto no mide:** nada del navegador. Los objetivos de LCP y TTI del
diseño necesitan un despliegue y una corrida de Lighthouse, y todavía no hay
despliegue.

---

## La región de las funciones tiene que ser la de la base

`apps/*/vercel.json` fija `"regions": ["gru1"]`. **No es una preferencia, es la
diferencia entre una aplicación usable y una que tarda tres segundos por clic.**

Medido en producción, con la base en `sa-east-1` (São Paulo):

| | funciones en `iad1` | funciones en `gru1` |
|---|---|---|
| `select 1` | 114 ms | 5 ms |
| una transacción con contexto de tenant | 570 ms | 26 ms |
| diez transacciones seguidas | 5.700 ms | 268 ms |

Una acción de dominio son diez o quince transacciones. En `iad1` eso son varios
segundos; en `gru1`, menos de medio.

**La trampa que me costó dos intentos:** el header `x-vercel-id` de la respuesta
dice `gru1` incluso cuando la función corre en `iad1`, porque esa es la región
del proxy, no la de la función. Para saber dónde corre de verdad hay que leer
`process.env.VERCEL_REGION` desde adentro. El default del proyecto era `iad1` y
el header me hizo descartar la región como causa.

Si algún día se mueve la base, hay que mover esto con ella.

## Base de datos

### Migrar

```bash
pnpm db:migrate
```

**Verificado.** Idempotente: aplica el bootstrap, las migraciones incrementales
de Drizzle y después reaplica enteros los archivos de `packages/db/src/sql/`
(roles, RLS, triggers, proyecciones, planes). Se puede correr dos veces
seguidas sin efecto.

**Si agregás una tabla con `agency_id`, agregala a la lista de
`0200_rls.sql`.** Si no, queda sin política, sin aislamiento, y ningún test
lo va a notar porque los tests de aislamiento recorren una lista fija.

### Respaldo fuera de la plataforma

Neon hace *point-in-time recovery* solo; la ventana depende del plan (en el
gratuito son 24 horas). Eso cubre el "borré algo hace una hora". No cubre
"perdí la cuenta de Neon", y para eso hace falta una copia afuera:

```bash
pg_dump --no-owner --no-privileges "$DATABASE_URL_UNPOOLED" > cuasar-$(date +%F).sql
```

**Sin probar, y con una trampa concreta:** el servidor es Postgres 18 y un
`pg_dump` más viejo se niega a conectarse. En esta máquina el cliente es 14, así
que el comando falla con `server version mismatch`. Antes de confiar en este
respaldo hay que instalar el cliente 18:

```bash
brew install postgresql@18
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
```

o correrlo en un contenedor:

```bash
docker run --rm -e PGURL="$DATABASE_URL_UNPOOLED" postgres:18-alpine \
  sh -c 'pg_dump --no-owner --no-privileges "$PGURL"' > cuasar-$(date +%F).sql
```

**Un respaldo que nadie restauró no es un respaldo.** La prueba pendiente es:
crear una rama nueva en Neon, restaurar el dump ahí, correr
`pnpm db:perf` apuntando a esa rama, y confirmar que los conteos coinciden.
Hasta que eso se haga, esta sección es una intención.

### Restaurar un borrado reciente

En Neon, crear una rama desde un timestamp anterior al incidente, verificar el
dato en la rama, y recién entonces decidir si se promueve o se copian las filas
a mano. **Nunca restaurar sobre la rama de producción sin haber mirado la
copia primero.**

---

## Los tres roles de base de datos

La aplicación se conecta siempre con el rol dueño y baja privilegios dentro de
cada transacción. Quién puede qué:

| | `app_tenant` | `app_platform` | `app_public` |
|---|---|---|---|
| Datos de su agencia | ✅ | — | solo el catálogo |
| Otras agencias | nunca (RLS) | cuentas y facturación | nunca (RLS) |
| `vehicles` (precio de compra) | ✅ | solo columnas de conteo | **sin permiso** |
| `vehicle_financials` | ✅ | — | **sin permiso** |
| Leer `leads` | ✅ | — | **sin permiso** (solo escribe) |
| Editar `vehicle_events` | nunca | nunca | nunca (solo inserta) |
| Escribir `subscriptions` | nunca | ✅ | nunca |

Si alguna de estas celdas cambia sin que cambien los tests de
`packages/db/tests/isolation.test.ts` y
`packages/core/tests/public.integration.test.ts`, algo está mal.

### Por qué los triggers de proyección son `security definer`

Mantener `vehicle_public_view` y `vehicle_financials` es una invariante
interna. Quien cambió la fila de origen ya tenía permiso para cambiarla, y no
tiene por qué tener además permiso sobre la tabla derivada: un moderador
suspendiendo una agencia puede escribir `agencies` pero no el catálogo, y sin
esto el trigger fallaba. Van con `search_path` fijo, que es obligatorio en una
función `definer`: sin él, quien la invoca puede anteponer un esquema propio y
hacer que `vehicles` apunte a una tabla suya.

---

## Límites de pedidos

Tres capas sobre el formulario público, de la más barata a la más precisa:

1. **Campo señuelo.** Oculto para una persona, visible para un bot que completa
   todo. Si viene lleno contestamos como si hubiera salido bien: un bot que
   recibe un error reintenta, uno que recibe un éxito se va.
2. **BotID.** Verificación de Vercel. En desarrollo es un no-op; solo funciona
   desplegado. **Sin probar en producción.**
3. **Tope por IP** (8 por hora) y **tope durable en la base** (3 por hora por
   teléfono). El segundo es el que importa: no depende de ningún caché y no se
   saltea reiniciando nada.

**Sin Redis el tope por IP es por instancia, no global.** Cada instancia lleva
su propia cuenta, así que el tope real se multiplica por la cantidad de
instancias. Con `KV_REST_API_URL` y `KV_REST_API_TOKEN` pasa a ser global sin
cambiar una línea de código. Aprovisionar Upstash requiere aceptar los términos
del marketplace en el navegador.

**Si el store de límites falla, se deja pasar.** Es una decisión: un Redis
caído no puede dejar a las agencias sin publicar ni a los compradores sin
consultar. El riesgo de una ventana sin tope es menor que el de una plataforma
caída por su propio guardia.

---

## Cola de salida

```bash
curl -H "authorization: Bearer $CRON_SECRET" \
  https://app.cuasar.app/api/cron/outbox-drain
```

Se drena por dos vías:

- **Después de cada consulta del sitio público**, con `after()`: corre fuera del
  camino de la respuesta, así que si el proveedor de mail está caído la persona
  igual ve su "consulta enviada".
- **Un cron diario** a las 9 (`apps/app/vercel.json`), como red para lo que
  quedó reintentando.

**Por qué diario y no cada cinco minutos:** el plan Hobby de Vercel solo
permite crons diarios, y un `*/5 * * * *` hace fallar el deploy entero con
`Hobby accounts are limited to daily cron jobs`. En Pro conviene bajarlo a
cinco minutos y el `after()` deja de ser el camino principal.

- Reintenta con espera creciente: 1, 2, 4, 8… minutos, hasta seis intentos.
- Después se rinde: la fila queda en `FAILED` y aparece en el panel de
  plataforma como "avisos que quedaron sin poder enviarse".
- Dos workers no mandan lo mismo dos veces (`for update skip locked`).
- Sin `RESEND_API_KEY` los mails quedan en el log y el mensaje se marca hecho.
  **Que falte el proveedor no puede romper nada.**

Para ver qué quedó trabado: el panel de `/plataforma`, o directo
`select * from outbox where status = 'FAILED'`.

---

## Invalidación del catálogo público

El backoffice y el sitio público son dos despliegues separados —tienen perfiles
de caché opuestos— así que `revalidateTag` en uno no alcanza al otro. El puente
es `POST /api/revalidate` en el sitio público, con `x-cuasar-secret`.

**Verificado localmente:** 401 con el secreto incorrecto, 200 con el correcto,
y `/api` queda afuera del proxy de resolución de dominio para que el backoffice
pueda llamarlo desde un host que no es de ninguna agencia.

Si un precio no se actualiza en el sitio: revisar `PUBLIC_SITE_URL` y
`REVALIDATE_SECRET` en el backoffice. La invalidación nunca hace fallar la
operación que la disparó, así que un fallo ahí es silencioso por diseño —
queda en el log como `no se pudo invalidar el catálogo público`.

---

## Webhooks de cobro

`POST /api/webhooks/stripe` y `/api/webhooks/mercadopago`.

Qué devolvemos y por qué:

| Situación | Código | Razón |
|---|---|---|
| Firma inválida | 400 | El proveedor deja de reintentar. Nada de lo que mande va a empezar a validar. |
| Evento ya procesado | 200 | Nada que hacer. |
| Suscripción desconocida | 200 | No se arregla reintentando. |
| Error al aplicar | 500 | Para que reintente: el evento quedó registrado sin `processed_at` y el reintento lo vuelve a aplicar. |

**Esa última fila es la que importa.** Si un reintento se descartara como
duplicado sin mirar si llegó a aplicarse, una caída entre registrar y aplicar
dejaría la suscripción desincronizada para siempre.

Para reprocesar algo a mano: borrar la fila de `billing_events` y reenviar el
evento desde el panel del proveedor.

---

## Dar de alta un moderador de plataforma

```bash
pnpm db:make-admin tu@mail.com          # ADMIN por defecto
pnpm db:make-admin soporte@mail.com SUPPORT
```

La persona tiene que haber entrado a la aplicación al menos una vez. No hay
alta desde la interfaz a propósito: quién puede suspender agencias se decide
con acceso a la base, no con un botón que alguien pueda encontrar.

`SUPPORT` ve las métricas; `ADMIN` además puede suspender y reactivar. Todo
queda en `audit_log`, que es append-only.

---

## Lo que falta conectar

Nada de esto bloquea el uso de la plataforma en modo prueba: las agencias
entran, cargan stock, publican y reciben consultas.

| Qué | Por qué está pendiente |
|---|---|
| GitHub App de Vercel | Sin eso no hay deploy automático por push |
| Stripe | Hay que aceptar los términos del marketplace en el navegador |
| MercadoPago | Access token y secreto de webhook de la cuenta |
| Resend | Dominio verificado por DNS |
| Upstash Redis | Términos del marketplace en el navegador |
| Sentry | Ni aprovisionado ni cableado |
| Restore probado | Ver la sección de respaldos |
| Recorrido con sesión iniciada | Nadie hizo clic en el backoffice todavía |
