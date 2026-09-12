# Cuasar — notas para trabajar en este repo

`DESIGN.md` es el contrato. Si algo durante la implementación lo contradice,
**parar y decirlo** en lugar de adaptar el código para esquivar el problema.

## Reglas que no se negocian

1. **Datos de agencia → `withTenant`.** Nunca `dbAdmin` en un request de usuario.
   `dbAdmin` es para migraciones, seeds, webhooks y workers.
2. **Toda tabla de negocio lleva `agency_id`, y todo índice lo pone primero.**
3. **Un cambio de estado y su evento de timeline van en la misma transacción.**
4. **Plata: enteros en centavos + moneda + `fx_rate` congelado.** Nunca float,
   nunca un monto sin moneda, nunca recalcular un `fx_rate` viejo.
5. **`SALES` no ve adquisición, costos ni márgenes.** Se filtra en el servicio de
   dominio, no en la UI: un campo oculto en el front igual viaja en el RSC payload.
6. **El dominio no importa SDKs de terceros.** Escribe en `outbox`; un worker
   drena y llama al adapter (`packages/core/src/ports`).
7. **Nada toca el sitio público sin invalidar su caché** en la misma operación.

## Después de cambiar el esquema

```bash
pnpm db:generate && pnpm db:migrate && pnpm test
```

Los archivos de `packages/db/src/sql/` son idempotentes y se reaplican enteros en
cada `db:migrate`; las migraciones de `drizzle/` son incrementales. Si agregás una
tabla con `agency_id`, agregala también a la lista de `0200_rls.sql` — si no,
queda sin política y sin aislamiento.

## Tests

Las tres suites que tocan la base corren **en serie**, encadenadas en
`turbo.json` (`db#test` → `core#test` → `integrations#test`). Comparten una sola
base de datos: en paralelo se pisan los datos entre ellas y fallan de formas que
no tienen nada que ver con el código. Cada suite limpia lo que crea y trabaja
sobre su propia ventana de fechas, para que dos corridas seguidas den lo mismo.


- `packages/core/tests/` — dominio puro, sin DB. Rápidos, corren siempre.
- `packages/db/tests/isolation.test.ts` — RLS y privilegios contra una base real.
  Necesita `pnpm db:seed` antes.

Los tests de integración tienen `testTimeout` en 20 s. No es porque sean lentos:
cada operación de dominio son diez o quince viajes a una base remota de ~70 ms
cada uno. Si uno falla por timeout, mirá la latencia de la red antes de tocar el
código.

## Performance

`pnpm db:perf --bench` mide las consultas calientes con volumen real y falla si
alguna se pasa de presupuesto o cae a scan secuencial. Corrélo después de tocar
un índice, agregar un join o cambiar el orden de un listado. El detalle está en
`OPERACIONES.md`.
