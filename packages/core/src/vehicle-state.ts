import { fail, ok, type Result } from './errors';

export const VEHICLE_STATUSES = [
  'INGRESADO',
  'EN_PREPARACION',
  'PUBLICADO',
  'RESERVADO',
  'VENDIDO',
  'PAUSADO',
  'DEVUELTO',
  'BAJA',
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export type Ownership = 'OWNED' | 'CONSIGNMENT';

/**
 * Transiciones válidas. Una transición inválida es un error de dominio,
 * no un update silencioso: el timeline tiene que poder explicar cómo llegó
 * el vehículo a donde está.
 */
const TRANSITIONS: Record<VehicleStatus, readonly VehicleStatus[]> = {
  INGRESADO: ['EN_PREPARACION', 'PUBLICADO', 'PAUSADO', 'DEVUELTO', 'BAJA'],
  EN_PREPARACION: ['PUBLICADO', 'PAUSADO', 'DEVUELTO', 'BAJA'],
  PUBLICADO: ['RESERVADO', 'VENDIDO', 'PAUSADO', 'EN_PREPARACION', 'DEVUELTO', 'BAJA'],
  RESERVADO: ['VENDIDO', 'PUBLICADO', 'PAUSADO', 'DEVUELTO', 'BAJA'],
  PAUSADO: ['PUBLICADO', 'EN_PREPARACION', 'DEVUELTO', 'BAJA'],
  // Estados terminales. Revertir una venta se hace con un ajuste explícito
  // y auditado, no con un cambio de estado hacia atrás.
  VENDIDO: [],
  DEVUELTO: [],
  BAJA: [],
};

/** Solo esto aparece en el sitio público. */
export const isPubliclyVisible = (status: VehicleStatus) => status === 'PUBLICADO';

export const isTerminal = (status: VehicleStatus) => TRANSITIONS[status].length === 0;

export function canTransition(from: VehicleStatus, to: VehicleStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type TransitionInput = {
  from: VehicleStatus;
  to: VehicleStatus;
  ownership: Ownership;
  hasImages: boolean;
  hasListPrice: boolean;
};

export function assertTransition(input: TransitionInput): Result<VehicleStatus> {
  const { from, to, ownership, hasImages, hasListPrice } = input;

  if (from === to) {
    return fail('INVALID_TRANSITION', `El vehículo ya está en ${to}.`);
  }

  if (!canTransition(from, to)) {
    return fail('INVALID_TRANSITION', `No se puede pasar de ${from} a ${to}.`, {
      from,
      to,
      allowed: TRANSITIONS[from],
    });
  }

  // Publicar sin precio o sin fotos produce una ficha que no sirve a nadie
  // y que igual se indexa. Se frena acá, no en la UI.
  if (to === 'PUBLICADO') {
    if (!hasListPrice) {
      return fail('VALIDATION', 'No se puede publicar un vehículo sin precio de venta.');
    }
    if (!hasImages) {
      return fail('VALIDATION', 'No se puede publicar un vehículo sin fotos.');
    }
  }

  // Devolver es cerrar un contrato de consignación: un auto propio no se devuelve.
  if (to === 'DEVUELTO' && ownership !== 'CONSIGNMENT') {
    return fail('INVALID_TRANSITION', 'Solo un vehículo en consignación puede devolverse.');
  }

  return ok(to);
}

export const allowedTransitions = (from: VehicleStatus): readonly VehicleStatus[] =>
  TRANSITIONS[from];

/** Días desde el ingreso. Vendido congela el contador en la fecha de venta. */
export function daysInStock(acquiredAt: Date, soldAt: Date | null, now = new Date()): number {
  const end = soldAt ?? now;
  const ms = end.getTime() - acquiredAt.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
