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
export const money = (prefix: string) => ({
  [`${prefix}AmountCents`]: bigint({ mode: 'bigint' }).notNull(),
  [`${prefix}Currency`]: char({ length: 3 }).notNull(),
  [`${prefix}FxRate`]: numeric({ precision: 20, scale: 10 }).notNull().default('1'),
  [`${prefix}AmountBaseCents`]: bigint({ mode: 'bigint' }).notNull(),
});
