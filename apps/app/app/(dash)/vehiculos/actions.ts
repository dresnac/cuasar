'use server';

import { del } from '@vercel/blob';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toBase, type Currency, type VehicleStatus } from '@cuasar/core';
import {
  addNote,
  attachImages,
  createVehicle,
  registerCost,
  registerSale,
  removeCost,
  removeImage,
  setCover,
  transitionVehicle,
  updateVehicle,
  type ImageInput,
} from '@cuasar/core/services';
import { requireSession } from '@/lib/tenant';

export type FormState = { error?: string; issues?: Record<string, string> };

/**
 * La plata se arma acá, no en el formulario.
 *
 * El usuario carga un monto y una moneda; la conversión a la base de la
 * agencia y la cotización congelada las resuelve el servidor. Un cliente
 * que pueda mandar `amountBaseCents` es un cliente que puede mentir sobre
 * el margen.
 */
const FX_MISSING = 'SIN_COTIZACION' as const;

type MoneyRead =
  | { amountCents: bigint; currency: Currency; fxRate: string; amountBaseCents: bigint }
  | null
  | typeof FX_MISSING;

function readMoney(fd: FormData, prefix: string, baseCurrency: Currency): MoneyRead {
  const raw = String(fd.get(`${prefix}Amount`) ?? '')
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');
  const units = Number(raw);
  if (!Number.isFinite(units) || units <= 0) return null;

  // Una operación se carga en una moneda, con una cotización: el auto, lo
  // que se pagó por él y el piso acordado se hablan en la misma unidad.
  const currency = (String(fd.get('currency') ?? baseCurrency) || baseCurrency) as Currency;
  const fxRate = String(fd.get('fxRate') ?? '').replace(',', '.').trim();

  // Sin cotización no se convierte "por las dudas": tomar 1 como default
  // metería un monto en pesos en una contabilidad en dólares y el error
  // recién se vería meses después, en un margen que no cierra.
  if (currency !== baseCurrency && !(Number(fxRate) > 0)) return FX_MISSING;

  const converted = toBase(
    { amountCents: BigInt(Math.round(units * 100)), currency },
    baseCurrency,
    fxRate || '1',
  );

  return {
    amountCents: converted.amountCents,
    currency: converted.currency,
    fxRate: converted.fxRate,
    amountBaseCents: converted.amountBaseCents,
  };
}

const FX_ERROR: FormState = {
  error: 'Falta la cotización del día para convertir a la moneda de la agencia.',
};

const text = (fd: FormData, key: string) => {
  const value = String(fd.get(key) ?? '').trim();
  return value === '' ? null : value;
};

export async function createVehicleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const base = session.agency.baseCurrency as Currency;
  const listPrice = readMoney(fd, 'listPrice', base);
  if (listPrice === FX_MISSING) return FX_ERROR;
  if (!listPrice) return { error: 'Falta el precio de venta.' };

  const ownership = String(fd.get('ownership')) === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'OWNED';
  const acquisition = readMoney(fd, 'acquisition', base);
  const agreedFloor = readMoney(fd, 'agreedFloor', base);

  if (acquisition === FX_MISSING || agreedFloor === FX_MISSING) return FX_ERROR;

  if (ownership === 'OWNED' && !acquisition) {
    return { error: 'Un vehículo propio necesita el precio al que lo compraste.' };
  }
  if (ownership === 'CONSIGNMENT' && !agreedFloor) {
    return { error: 'Una consignación necesita el piso acordado con el dueño.' };
  }

  const result = await createVehicle(session.ctx, {
    brand: text(fd, 'brand'),
    model: text(fd, 'model'),
    version: text(fd, 'version'),
    year: fd.get('year'),
    km: fd.get('km') || 0,
    fuel: text(fd, 'fuel'),
    transmission: text(fd, 'transmission'),
    color: text(fd, 'color'),
    doors: text(fd, 'doors'),
    licensePlate: text(fd, 'licensePlate'),
    vin: text(fd, 'vin'),
    description: text(fd, 'description'),
    features: String(fd.get('features') ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean),
    ownership,
    listPrice,
    acquiredAt: text(fd, 'acquiredAt') ?? new Date(),
    acquisition: ownership === 'OWNED' ? acquisition : null,
    consignment:
      ownership === 'CONSIGNMENT' && agreedFloor
        ? {
            consignorName: text(fd, 'consignorName') ?? '',
            consignorDoc: text(fd, 'consignorDoc'),
            consignorPhone: text(fd, 'consignorPhone'),
            consignorEmail: text(fd, 'consignorEmail'),
            agreedFloor,
            commissionType: String(fd.get('commissionType')) === 'FIXED' ? 'FIXED' : 'PCT',
            commissionValue: String(fd.get('commissionValue') ?? '0'),
            contractStartsAt:
              text(fd, 'contractStartsAt') ?? new Date().toISOString().slice(0, 10),
            contractEndsAt: text(fd, 'contractEndsAt'),
          }
        : null,
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/vehiculos');
  redirect(`/vehiculos/${result.data.id}?nuevo=1`);
}

export async function updateVehicleAction(
  vehicleId: string,
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const base = session.agency.baseCurrency as Currency;
  const listPrice = readMoney(fd, 'listPrice', base);
  if (listPrice === FX_MISSING) return FX_ERROR;

  const result = await updateVehicle(session.ctx, vehicleId, {
    brand: text(fd, 'brand') ?? undefined,
    model: text(fd, 'model') ?? undefined,
    version: text(fd, 'version'),
    year: fd.get('year') || undefined,
    km: fd.get('km') || undefined,
    fuel: text(fd, 'fuel'),
    transmission: text(fd, 'transmission'),
    color: text(fd, 'color'),
    doors: text(fd, 'doors'),
    licensePlate: text(fd, 'licensePlate'),
    vin: text(fd, 'vin'),
    description: text(fd, 'description'),
    ...(listPrice ? { listPrice } : {}),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/vehiculos/${vehicleId}`);
  revalidatePath('/vehiculos');
  return {};
}

export async function transitionAction(vehicleId: string, to: VehicleStatus): Promise<FormState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await transitionVehicle(session.ctx, vehicleId, to);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/vehiculos/${vehicleId}`);
  revalidatePath('/vehiculos');
  return {};
}

export async function addNoteAction(
  vehicleId: string,
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await addNote(session.ctx, vehicleId, String(fd.get('note') ?? ''));
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/vehiculos/${vehicleId}`);
  return {};
}

export async function attachImagesAction(vehicleId: string, images: ImageInput[]) {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await attachImages(session.ctx, vehicleId, images);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/vehiculos/${vehicleId}`);
  revalidatePath('/vehiculos');
  return {};
}

export async function removeImageAction(vehicleId: string, imageId: string): Promise<FormState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await removeImage(session.ctx, vehicleId, imageId);
  if (!result.ok) return { error: result.error.message };

  // El blob se borra después de que la base confirmó: si fallara al revés,
  // quedaría una ficha apuntando a una imagen que ya no existe.
  try {
    await del(result.data.blobPathname);
  } catch {
    // El archivo huérfano lo limpia el barrido periódico; no es motivo
    // para que la operación falle a los ojos del usuario.
  }

  revalidatePath(`/vehiculos/${vehicleId}`);
  revalidatePath('/vehiculos');
  return {};
}

export async function setCoverAction(vehicleId: string, imageId: string): Promise<FormState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await setCover(session.ctx, vehicleId, imageId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/vehiculos/${vehicleId}`);
  revalidatePath('/vehiculos');
  return {};
}

// ---------------------------------------------------------------------------
// Contabilidad de la unidad
// ---------------------------------------------------------------------------

export async function registerCostAction(
  vehicleId: string,
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const base = session.agency.baseCurrency as Currency;
  const value = readMoney(fd, 'cost', base);
  if (value === FX_MISSING) return FX_ERROR;
  if (!value) return { error: 'Poné el monto del gasto.' };

  const result = await registerCost(session.ctx, vehicleId, {
    category: fd.get('category'),
    description: text(fd, 'description'),
    supplier: text(fd, 'supplier'),
    invoiceRef: text(fd, 'invoiceRef'),
    occurredAt: text(fd, 'occurredAt') ?? new Date(),
    value,
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/vehiculos/${vehicleId}`);
  revalidatePath('/vehiculos');
  revalidatePath('/contabilidad');
  return {};
}

export async function removeCostAction(vehicleId: string, costId: string): Promise<FormState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await removeCost(session.ctx, vehicleId, costId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/vehiculos/${vehicleId}`);
  revalidatePath('/contabilidad');
  return {};
}

export async function registerSaleAction(
  vehicleId: string,
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const base = session.agency.baseCurrency as Currency;
  const value = readMoney(fd, 'sale', base);
  if (value === FX_MISSING) return FX_ERROR;
  if (!value) return { error: 'Poné a cuánto se vendió.' };

  const result = await registerSale(session.ctx, vehicleId, {
    value,
    buyerName: text(fd, 'buyerName'),
    buyerDoc: text(fd, 'buyerDoc'),
    buyerPhone: text(fd, 'buyerPhone'),
    paymentMethod: text(fd, 'paymentMethod'),
    salespersonUserId: text(fd, 'salespersonUserId'),
    soldAt: text(fd, 'soldAt') ?? new Date(),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/vehiculos/${vehicleId}`);
  revalidatePath('/vehiculos');
  revalidatePath('/contabilidad');
  return {};
}
