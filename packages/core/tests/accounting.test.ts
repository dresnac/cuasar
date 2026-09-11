import { describe, expect, it } from 'vitest';
import { computeVehicleResult, summarizePortfolio } from '../src/accounting';

const usd = (n: number) => BigInt(n) * 100n;

describe('vehículo propio', () => {
  it('margen = venta − compra − gastos', () => {
    const r = computeVehicleResult({
      ownership: 'OWNED',
      acquisitionBaseCents: usd(10_000),
      costsBaseCents: usd(800),
      saleBaseCents: usd(12_500),
    });

    expect(r.investedBaseCents).toBe(usd(10_800));
    expect(r.grossMarginBaseCents).toBe(usd(1_700));
    expect(r.marginPct).toBeCloseTo(15.74, 2);
  });

  it('sin venta no hay margen, hay capital inmovilizado', () => {
    const r = computeVehicleResult({
      ownership: 'OWNED',
      acquisitionBaseCents: usd(10_000),
      costsBaseCents: usd(500),
      saleBaseCents: null,
    });

    expect(r.grossMarginBaseCents).toBeNull();
    expect(r.marginPct).toBeNull();
    expect(r.investedBaseCents).toBe(usd(10_500));
  });

  it('una venta por debajo del costo da margen negativo, no cero', () => {
    const r = computeVehicleResult({
      ownership: 'OWNED',
      acquisitionBaseCents: usd(10_000),
      costsBaseCents: usd(2_000),
      saleBaseCents: usd(11_000),
    });

    expect(r.grossMarginBaseCents).toBe(usd(-1_000));
  });
});

describe('consignación', () => {
  it('el capital del dueño no entra en el resultado de la agencia', () => {
    const r = computeVehicleResult({
      ownership: 'CONSIGNMENT',
      acquisitionBaseCents: usd(10_000), // informativo: no es plata de la agencia
      costsBaseCents: usd(300),
      saleBaseCents: usd(12_000),
      commission: { type: 'PCT', value: '5' },
    });

    expect(r.commissionBaseCents).toBe(usd(600));
    expect(r.grossMarginBaseCents).toBe(usd(300));
    // Lo único inmovilizado es lo que la agencia puso de su bolsillo.
    expect(r.investedBaseCents).toBe(usd(300));
  });

  it('comisión fija', () => {
    const r = computeVehicleResult({
      ownership: 'CONSIGNMENT',
      acquisitionBaseCents: 0n,
      costsBaseCents: usd(100),
      saleBaseCents: usd(9_000),
      commission: { type: 'FIXED', value: '50000' },
    });

    expect(r.commissionBaseCents).toBe(usd(500));
    expect(r.grossMarginBaseCents).toBe(usd(400));
  });

  it('gastos sin venta todavía no son pérdida declarada', () => {
    const r = computeVehicleResult({
      ownership: 'CONSIGNMENT',
      acquisitionBaseCents: 0n,
      costsBaseCents: usd(200),
      saleBaseCents: null,
      commission: { type: 'PCT', value: '5' },
    });

    expect(r.grossMarginBaseCents).toBeNull();
    expect(r.commissionBaseCents).toBe(0n);
  });

  it('la comisión porcentual con decimales no pierde centavos por float', () => {
    const r = computeVehicleResult({
      ownership: 'CONSIGNMENT',
      acquisitionBaseCents: 0n,
      costsBaseCents: 0n,
      saleBaseCents: 1_234_567n,
      commission: { type: 'PCT', value: '3.33' },
    });

    // 1234567 * 333 / 10000 = 41111.1... -> trunca a 41111
    expect(r.commissionBaseCents).toBe(41_111n);
  });
});

describe('cartera', () => {
  it('capital inmovilizado cuenta solo unidades propias en stock', () => {
    const s = summarizePortfolio([
      {
        ownership: 'OWNED',
        acquisitionBaseCents: usd(10_000),
        costsBaseCents: usd(500),
        saleBaseCents: null,
        sold: false,
        daysInStock: 30,
      },
      {
        ownership: 'CONSIGNMENT',
        acquisitionBaseCents: usd(8_000),
        costsBaseCents: usd(100),
        saleBaseCents: null,
        commission: { type: 'PCT', value: '5' },
        sold: false,
        daysInStock: 10,
      },
      {
        ownership: 'OWNED',
        acquisitionBaseCents: usd(5_000),
        costsBaseCents: usd(200),
        saleBaseCents: usd(6_500),
        sold: true,
        daysInStock: 20,
      },
    ]);

    expect(s.ownedCount).toBe(2);
    expect(s.consignmentCount).toBe(1);
    // Solo el propio en stock: los 8.000 de la consignación no son de la agencia.
    expect(s.capitalTiedBaseCents).toBe(usd(10_000));
    expect(s.realizedMarginBaseCents).toBe(usd(1_300));
    expect(s.avgDaysInStock).toBe(20);
  });
});
