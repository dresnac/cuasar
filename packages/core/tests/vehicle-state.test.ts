import { describe, expect, it } from 'vitest';
import { assertTransition, daysInStock, isTerminal } from '../src/vehicle-state';

const base = {
  ownership: 'OWNED' as const,
  hasImages: true,
  hasListPrice: true,
};

describe('transiciones', () => {
  it('permite el camino normal hasta la venta', () => {
    expect(assertTransition({ ...base, from: 'INGRESADO', to: 'EN_PREPARACION' }).ok).toBe(true);
    expect(assertTransition({ ...base, from: 'EN_PREPARACION', to: 'PUBLICADO' }).ok).toBe(true);
    expect(assertTransition({ ...base, from: 'PUBLICADO', to: 'RESERVADO' }).ok).toBe(true);
    expect(assertTransition({ ...base, from: 'RESERVADO', to: 'VENDIDO' }).ok).toBe(true);
  });

  it('VENDIDO es terminal: no se revierte cambiando el estado', () => {
    expect(isTerminal('VENDIDO')).toBe(true);
    const r = assertTransition({ ...base, from: 'VENDIDO', to: 'PUBLICADO' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
  });

  it('no publica sin precio', () => {
    const r = assertTransition({ ...base, hasListPrice: false, from: 'INGRESADO', to: 'PUBLICADO' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/precio/i);
  });

  it('no publica sin fotos', () => {
    const r = assertTransition({ ...base, hasImages: false, from: 'INGRESADO', to: 'PUBLICADO' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/fotos/i);
  });

  it('solo una consignación se devuelve', () => {
    expect(assertTransition({ ...base, from: 'PUBLICADO', to: 'DEVUELTO' }).ok).toBe(false);
    expect(
      assertTransition({ ...base, ownership: 'CONSIGNMENT', from: 'PUBLICADO', to: 'DEVUELTO' }).ok,
    ).toBe(true);
  });

  it('rechaza la transición a sí mismo', () => {
    expect(assertTransition({ ...base, from: 'PUBLICADO', to: 'PUBLICADO' }).ok).toBe(false);
  });
});

describe('días en stock', () => {
  it('cuenta hasta hoy si sigue en stock', () => {
    const acquired = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-03-02T00:00:00Z');
    expect(daysInStock(acquired, null, now)).toBe(60);
  });

  it('se congela en la fecha de venta', () => {
    const acquired = new Date('2026-01-01T00:00:00Z');
    const sold = new Date('2026-01-21T00:00:00Z');
    const now = new Date('2026-06-01T00:00:00Z');
    expect(daysInStock(acquired, sold, now)).toBe(20);
  });
});
