import {
  and,
  desc,
  eq,
  schema,
  withTenant,
  type TenantCtx,
} from '@cuasar/db';
import { z } from 'zod';
import { fail, ok, type Result } from '../errors';
import { can } from '../permissions';
import { assertTransition, type Ownership, type VehicleStatus } from '../vehicle-state';
import { appendEvent } from './_tx';

const { vehicles, vehicleCosts, vehicleSales, vehicleAcquisitions, consignments } = schema;

const moneyInput = z.object({
  amountCents: z.coerce.bigint().positive(),
  currency: z.enum(['USD', 'ARS']),
  fxRate: z.string().default('1'),
  amountBaseCents: z.coerce.bigint().nonnegative(),
});

// ---------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------

export const costInput = z.object({
  category: z.enum(schema.costCategory.enumValues),
  description: z.string().max(200).nullish(),
  supplier: z.string().max(120).nullish(),
  invoiceRef: z.string().max(60).nullish(),
  occurredAt: z.coerce.date().default(() => new Date()),
  value: moneyInput,
});

export type CostInput = z.infer<typeof costInput>;

/**
 * Un gasto sobre una unidad.
 *
 * El trigger `vehicle_costs_recompute_financials` actualiza la proyección
 * contable dentro de esta misma transacción: cuando la llamada vuelve, el
 * dashboard ya refleja el gasto. No hay job intermedio que pueda quedarse
 * atrás y mostrar un margen viejo.
 */
export async function registerCost(
  ctx: TenantCtx,
  vehicleId: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  if (!can(ctx.role, 'finance:write')) {
    return fail('FORBIDDEN', 'No podés registrar gastos.');
  }

  const parsed = costInput.safeParse(raw);
  if (!parsed.success) {
    return fail('VALIDATION', 'Revisá los datos del gasto.', { issues: parsed.error.issues });
  }
  const input = parsed.data;

  return withTenant(ctx, async (tx) => {
    const [vehicle] = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) return fail<{ id: string }>('NOT_FOUND', 'El vehículo no existe.');

    const [created] = await tx
      .insert(vehicleCosts)
      .values({
        agencyId: ctx.agencyId,
        vehicleId,
        category: input.category,
        description: input.description ?? null,
        supplier: input.supplier ?? null,
        invoiceRef: input.invoiceRef ?? null,
        occurredAt: input.occurredAt,
        createdBy: ctx.userId,
        valueAmountCents: input.value.amountCents,
        valueCurrency: input.value.currency,
        valueFxRate: input.value.fxRate,
        valueAmountBaseCents: input.value.amountBaseCents,
      })
      .returning({ id: vehicleCosts.id });

    await appendEvent(tx, ctx, {
      vehicleId,
      type: 'COST_REGISTERED',
      payload: {
        costId: created!.id,
        category: input.category,
        description: input.description ?? null,
        amount: input.value.amountCents.toString(),
        currency: input.value.currency,
      },
    });

    return ok({ id: created!.id });
  });
}

export async function removeCost(
  ctx: TenantCtx,
  vehicleId: string,
  costId: string,
): Promise<Result<true>> {
  if (!can(ctx.role, 'finance:write')) return fail('FORBIDDEN', 'No podés borrar gastos.');

  return withTenant(ctx, async (tx) => {
    const [deleted] = await tx
      .delete(vehicleCosts)
      .where(and(eq(vehicleCosts.id, costId), eq(vehicleCosts.vehicleId, vehicleId)))
      .returning({ amount: vehicleCosts.valueAmountCents, category: vehicleCosts.category });

    if (!deleted) return fail<true>('NOT_FOUND', 'El gasto no existe.');

    // Borrar un gasto cambia el margen: queda en el historial para que el
    // número de ayer se pueda explicar.
    await appendEvent(tx, ctx, {
      vehicleId,
      type: 'COST_REMOVED',
      payload: { costId, category: deleted.category, amount: deleted.amount.toString() },
    });

    return ok(true as const);
  });
}

export type CostRow = {
  id: string;
  category: string;
  description: string | null;
  supplier: string | null;
  invoiceRef: string | null;
  occurredAt: Date;
  amountCents: bigint;
  currency: string;
  amountBaseCents: bigint;
  createdByName: string | null;
};

export async function listCosts(ctx: TenantCtx, vehicleId: string): Promise<CostRow[]> {
  if (!can(ctx.role, 'finance:read')) return [];

  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: vehicleCosts.id,
        category: vehicleCosts.category,
        description: vehicleCosts.description,
        supplier: vehicleCosts.supplier,
        invoiceRef: vehicleCosts.invoiceRef,
        occurredAt: vehicleCosts.occurredAt,
        amountCents: vehicleCosts.valueAmountCents,
        currency: vehicleCosts.valueCurrency,
        amountBaseCents: vehicleCosts.valueAmountBaseCents,
        createdByName: schema.users.name,
      })
      .from(vehicleCosts)
      .leftJoin(schema.users, eq(schema.users.id, vehicleCosts.createdBy))
      .where(eq(vehicleCosts.vehicleId, vehicleId))
      .orderBy(desc(vehicleCosts.occurredAt), desc(vehicleCosts.id)),
  );
}

// ---------------------------------------------------------------------------
// Venta
// ---------------------------------------------------------------------------

export const saleInput = z.object({
  value: moneyInput,
  buyerName: z.string().max(120).nullish(),
  buyerDoc: z.string().max(20).nullish(),
  buyerPhone: z.string().max(30).nullish(),
  paymentMethod: z.string().max(60).nullish(),
  salespersonUserId: z.string().uuid().nullish(),
  soldAt: z.coerce.date().default(() => new Date()),
});

/**
 * Cerrar la venta.
 *
 * Marcar "vendido" y registrar a cuánto se vendió son el mismo acto, así que
 * son una sola operación: un vehículo en estado VENDIDO sin fila en
 * `vehicle_sales` sería un agujero silencioso en la contabilidad.
 */
export async function registerSale(
  ctx: TenantCtx,
  vehicleId: string,
  raw: unknown,
): Promise<Result<{ marginBaseCents: bigint | null }>> {
  if (!can(ctx.role, 'finance:write')) {
    return fail('FORBIDDEN', 'No podés cerrar ventas.');
  }

  const parsed = saleInput.safeParse(raw);
  if (!parsed.success) {
    return fail('VALIDATION', 'Revisá los datos de la venta.', { issues: parsed.error.issues });
  }
  const input = parsed.data;

  return withTenant(ctx, async (tx) => {
    const [vehicle] = await tx
      .select({
        status: vehicles.status,
        ownership: vehicles.ownership,
        listPrice: vehicles.listPriceAmountCents,
      })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!vehicle) return fail<{ marginBaseCents: bigint | null }>('NOT_FOUND', 'El vehículo no existe.');

    const check = assertTransition({
      from: vehicle.status as VehicleStatus,
      to: 'VENDIDO',
      ownership: vehicle.ownership as Ownership,
      hasImages: true,
      hasListPrice: vehicle.listPrice > 0n,
    });
    if (!check.ok) return check as Result<{ marginBaseCents: bigint | null }>;

    // Un piso acordado con el dueño de una consignación no es una sugerencia:
    // vender por debajo es incumplir el contrato.
    if (vehicle.ownership === 'CONSIGNMENT') {
      const [contract] = await tx
        .select({ floor: consignments.agreedFloorAmountBaseCents })
        .from(consignments)
        .where(eq(consignments.vehicleId, vehicleId))
        .limit(1);

      if (contract && input.value.amountBaseCents < contract.floor) {
        return fail<{ marginBaseCents: bigint | null }>(
          'VALIDATION',
          'La venta está por debajo del piso acordado con el dueño.',
          { floor: contract.floor.toString() },
        );
      }
    }

    await tx.insert(vehicleSales).values({
      vehicleId,
      agencyId: ctx.agencyId,
      valueAmountCents: input.value.amountCents,
      valueCurrency: input.value.currency,
      valueFxRate: input.value.fxRate,
      valueAmountBaseCents: input.value.amountBaseCents,
      buyer: {
        name: input.buyerName ?? null,
        doc: input.buyerDoc ?? null,
        phone: input.buyerPhone ?? null,
      },
      paymentMethod: input.paymentMethod ?? null,
      salespersonUserId: input.salespersonUserId ?? ctx.userId,
      soldAt: input.soldAt,
    });

    await tx
      .update(vehicles)
      .set({ status: 'VENDIDO', soldAt: input.soldAt })
      .where(eq(vehicles.id, vehicleId));

    await appendEvent(tx, ctx, {
      vehicleId,
      type: 'STATUS_CHANGED',
      payload: { from: vehicle.status, to: 'VENDIDO' },
    });
    await appendEvent(tx, ctx, {
      vehicleId,
      type: 'SOLD',
      payload: {
        amount: input.value.amountCents.toString(),
        currency: input.value.currency,
        buyer: input.buyerName ?? null,
      },
    });

    // La proyección ya se recalculó por trigger; la leemos para devolver el
    // resultado real y no una cuenta hecha de nuevo en la aplicación.
    const [financials] = await tx
      .select({ margin: schema.vehicleFinancials.grossMarginBaseCents })
      .from(schema.vehicleFinancials)
      .where(eq(schema.vehicleFinancials.vehicleId, vehicleId))
      .limit(1);

    return ok({ marginBaseCents: financials?.margin ?? null });
  });
}

export async function getSale(ctx: TenantCtx, vehicleId: string) {
  if (!can(ctx.role, 'finance:read')) return null;

  return withTenant(ctx, async (tx) => {
    const [sale] = await tx
      .select({
        amountCents: vehicleSales.valueAmountCents,
        currency: vehicleSales.valueCurrency,
        amountBaseCents: vehicleSales.valueAmountBaseCents,
        buyer: vehicleSales.buyer,
        paymentMethod: vehicleSales.paymentMethod,
        soldAt: vehicleSales.soldAt,
        salespersonName: schema.users.name,
      })
      .from(vehicleSales)
      .leftJoin(schema.users, eq(schema.users.id, vehicleSales.salespersonUserId))
      .where(eq(vehicleSales.vehicleId, vehicleId))
      .limit(1);

    return sale ?? null;
  });
}

/** Corrige el precio de compra cuando se cargó mal. Queda en el historial. */
export async function updateAcquisition(
  ctx: TenantCtx,
  vehicleId: string,
  raw: unknown,
): Promise<Result<true>> {
  if (!can(ctx.role, 'finance:write')) return fail('FORBIDDEN', 'No podés tocar la compra.');

  const parsed = moneyInput.safeParse(raw);
  if (!parsed.success) return fail('VALIDATION', 'Revisá el monto de la compra.');

  return withTenant(ctx, async (tx) => {
    const [updated] = await tx
      .update(vehicleAcquisitions)
      .set({
        valueAmountCents: parsed.data.amountCents,
        valueCurrency: parsed.data.currency,
        valueFxRate: parsed.data.fxRate,
        valueAmountBaseCents: parsed.data.amountBaseCents,
      })
      .where(eq(vehicleAcquisitions.vehicleId, vehicleId))
      .returning({ id: vehicleAcquisitions.vehicleId });

    if (!updated) return fail<true>('NOT_FOUND', 'Esta unidad no tiene una compra registrada.');

    await appendEvent(tx, ctx, {
      vehicleId,
      type: 'ACQUISITION_REGISTERED',
      payload: {
        amount: parsed.data.amountCents.toString(),
        currency: parsed.data.currency,
        corrected: true,
      },
    });

    return ok(true as const);
  });
}
