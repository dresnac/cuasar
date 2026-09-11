import { describe, expect, it } from 'vitest';
import { money, toBase } from '../src/money';

describe('conversión a moneda base', () => {
  it('no toca el monto si ya está en la base', () => {
    const r = toBase(money(150_000, 'USD'), 'USD', '1450.50');
    expect(r.amountBaseCents).toBe(150_000n);
    expect(r.fxRate).toBe('1');
  });

  it('convierte ARS a USD con la cotización del momento', () => {
    // 1.450.500,00 ARS (=145.050.000 centavos) a 1450.50 ARS/USD = 1.000,00 USD
    const r = toBase(money(145_050_000, 'ARS'), 'USD', '1450.50');
    expect(r.amountBaseCents).toBe(100_000n);
  });

  it('redondea half-up, no trunca', () => {
    const r = toBase(money(100, 'ARS'), 'USD', '3');
    expect(r.amountBaseCents).toBe(33n);

    const r2 = toBase(money(101, 'ARS'), 'USD', '3');
    expect(r2.amountBaseCents).toBe(34n);
  });

  it('conserva la cotización usada para que el histórico no se mueva', () => {
    const r = toBase(money(1_000_000, 'ARS'), 'USD', '1234.5678901234');
    expect(r.fxRate).toBe('1234.5678901234');
    expect(r.currency).toBe('ARS');
    expect(r.amountCents).toBe(1_000_000n);
  });

  it('rechaza una cotización inválida en lugar de producir un número absurdo', () => {
    expect(() => toBase(money(100, 'ARS'), 'USD', '0')).toThrow();
  });
});
