import type { Ownership } from './vehicle-state';

/**
 * Contabilidad por unidad.
 *
 * El punto del módulo: propio y consignación NO se calculan igual, y
 * mezclarlos da números falsos. En un auto propio la agencia inmovilizó
 * capital y su resultado es venta − compra − gastos. En consignación el
 * capital es de un tercero: el resultado es la comisión menos lo que la
 * agencia sí puso de su bolsillo.
 *
 * Todos los montos llegan ya convertidos a la moneda base de la agencia
 * (ver money.ts). Acá no se convierte nada.
 */
export type VehicleLedger = {
  ownership: Ownership;
  acquisitionBaseCents: bigint;
  costsBaseCents: bigint;
  saleBaseCents: bigint | null;
  commission?: { type: 'PCT' | 'FIXED'; value: string } | null;
};

export type VehicleResult = {
  /** Capital propio inmovilizado. Cero en consignación, por definición. */
  investedBaseCents: bigint;
  commissionBaseCents: bigint;
  /** null mientras no se vendió: un margen sin venta es una proyección, no un resultado. */
  grossMarginBaseCents: bigint | null;
  marginPct: number | null;
};

export function computeVehicleResult(ledger: VehicleLedger): VehicleResult {
  const { ownership, costsBaseCents, saleBaseCents } = ledger;

  if (ownership === 'CONSIGNMENT') {
    const commissionBaseCents = computeCommission(ledger);
    const grossMarginBaseCents =
      saleBaseCents === null ? null : commissionBaseCents - costsBaseCents;

    return {
      investedBaseCents: costsBaseCents,
      commissionBaseCents,
      grossMarginBaseCents,
      marginPct: pct(grossMarginBaseCents, saleBaseCents),
    };
  }

  const invested = ledger.acquisitionBaseCents + costsBaseCents;
  const grossMarginBaseCents = saleBaseCents === null ? null : saleBaseCents - invested;

  return {
    investedBaseCents: invested,
    commissionBaseCents: 0n,
    grossMarginBaseCents,
    marginPct: pct(grossMarginBaseCents, invested),
  };
}

function computeCommission(ledger: VehicleLedger): bigint {
  if (!ledger.commission || ledger.saleBaseCents === null) return 0n;

  if (ledger.commission.type === 'FIXED') {
    return BigInt(ledger.commission.value.split('.')[0] ?? '0');
  }

  // PCT sobre el precio de venta, truncado a centavos.
  const [whole = '0', frac = ''] = ledger.commission.value.split('.');
  const basisPoints = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  return (ledger.saleBaseCents * basisPoints) / 10_000n;
}

function pct(margin: bigint | null, base: bigint | null): number | null {
  if (margin === null || base === null || base === 0n) return null;
  return Number((margin * 10_000n) / base) / 100;
}

/**
 * Agregado de cartera. Declara explícitamente qué incluye, porque sumar
 * autos propios y en consignación en "capital inmovilizado" es exactamente
 * cómo se produce un número que parece correcto y no lo es.
 */
export type PortfolioSummary = {
  ownedCount: number;
  consignmentCount: number;
  /** Solo unidades propias en stock: es plata de la agencia parada. */
  capitalTiedBaseCents: bigint;
  costsInStockBaseCents: bigint;
  realizedMarginBaseCents: bigint;
  avgDaysInStock: number;
};

export function summarizePortfolio(
  rows: readonly (VehicleLedger & { sold: boolean; daysInStock: number })[],
): PortfolioSummary {
  let ownedCount = 0;
  let consignmentCount = 0;
  let capitalTied = 0n;
  let costsInStock = 0n;
  let realized = 0n;
  let days = 0;

  for (const row of rows) {
    if (row.ownership === 'OWNED') ownedCount++;
    else consignmentCount++;

    const result = computeVehicleResult(row);

    if (row.sold) {
      realized += result.grossMarginBaseCents ?? 0n;
    } else {
      if (row.ownership === 'OWNED') capitalTied += row.acquisitionBaseCents;
      costsInStock += row.costsBaseCents;
    }
    days += row.daysInStock;
  }

  return {
    ownedCount,
    consignmentCount,
    capitalTiedBaseCents: capitalTied,
    costsInStockBaseCents: costsInStock,
    realizedMarginBaseCents: realized,
    avgDaysInStock: rows.length ? Math.round(days / rows.length) : 0,
  };
}
