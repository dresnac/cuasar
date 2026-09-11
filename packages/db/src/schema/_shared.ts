import { sql } from 'drizzle-orm';
import { bigint, char, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * UUIDv7: ordenable en el tiempo, así el índice primario mantiene localidad
 * y los listados "más reciente primero" no necesitan otra columna.
 * La función se crea en la migración 0000_bootstrap.sql.
 */
export const pk = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);

export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

/**
 * Plata. Nunca float, nunca un monto sin moneda.
 *
 * - `amountCents`     monto en la moneda en que ocurrió la operación
 * - `currency`        ISO-4217 de esa operación
 * - `fxRate`          cotización usada, congelada al momento del registro
 * - `amountBaseCents` el mismo monto en la moneda base DE LA AGENCIA
 *
 * `fxRate` no se recalcula jamás: un margen histórico tiene que seguir
 * dando lo mismo dentro de dos años.
 */
const amountColumn = () => bigint({ mode: 'bigint' }).notNull();
const currencyColumn = () => char({ length: 3 }).notNull();
const fxRateColumn = () => numeric({ precision: 20, scale: 10 }).notNull().default('1');

type MoneyColumns<P extends string> = Record<
  `${P}AmountCents` | `${P}AmountBaseCents`,
  ReturnType<typeof amountColumn>
> &
  Record<`${P}Currency`, ReturnType<typeof currencyColumn>> &
  Record<`${P}FxRate`, ReturnType<typeof fxRateColumn>>;

export function money<P extends string>(prefix: P): MoneyColumns<P> {
  // El cast es necesario porque TS no infiere claves de template literal
  // desde un objeto con claves computadas. Las cuatro columnas siempre
  // van juntas: un monto suelto, sin su moneda y su cotización, no significa nada.
  return {
    [`${prefix}AmountCents`]: amountColumn(),
    [`${prefix}Currency`]: currencyColumn(),
    [`${prefix}FxRate`]: fxRateColumn(),
    [`${prefix}AmountBaseCents`]: amountColumn(),
  } as MoneyColumns<P>;
}
