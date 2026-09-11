import { describe, expect, it } from 'vitest';
import { can, canSeeFinancials } from '../src/permissions';

describe('roles', () => {
  it('SALES no ve plata de costos ni márgenes', () => {
    expect(canSeeFinancials('SALES')).toBe(false);
    expect(can('SALES', 'finance:read')).toBe(false);
    expect(can('SALES', 'finance:write')).toBe(false);
  });

  it('SALES sí opera el vehículo y ve el piso de negociación', () => {
    expect(can('SALES', 'vehicle:write')).toBe(true);
    expect(can('SALES', 'vehicle:publish')).toBe(true);
    expect(can('SALES', 'price:floor:read')).toBe(true);
  });

  it('SALES no cambia el precio de lista ni administra usuarios', () => {
    expect(can('SALES', 'price:list:write')).toBe(false);
    expect(can('SALES', 'member:manage')).toBe(false);
    expect(can('SALES', 'billing:manage')).toBe(false);
  });

  it('VIEWER solo lee y no ve el piso', () => {
    expect(can('VIEWER', 'vehicle:read')).toBe(true);
    expect(can('VIEWER', 'vehicle:write')).toBe(false);
    expect(can('VIEWER', 'price:floor:read')).toBe(false);
  });

  it('OWNER y ADMIN ven la contabilidad', () => {
    expect(canSeeFinancials('OWNER')).toBe(true);
    expect(canSeeFinancials('ADMIN')).toBe(true);
  });
});
