'use server';

import { del } from '@vercel/blob';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toBase, type Currency, type VehicleStatus } from '@cuasar/core';
import {
  addNote,
  attachImages,
  createVehicle,
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
function readMoney(fd: FormData, prefix: string, baseCurrency: Currency) {
  const raw = String(fd.get(`${prefix}Amount`) ?? '')
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');
  const units = Number(raw);
  if (!Number.isFinite(units) || units <= 0) return null;

  // Una operación se carga en una moneda, con una cotización: el auto, lo
  // que se pagó por él y el piso acordado se hablan en la misma unidad.
  const currency = (String(fd.get('currency') ?? baseCurrency) || baseCurrency) as Currency;
  const fxRate = String(fd.get('fxRate') ?? '').trim() || '1';

  const converted = toBase(
    { amountCents: BigInt(Math.round(units * 100)), currency },
    baseCurrency,
    fxRate,
  );

  return {
    amountCents: converted.amountCents,
    currency: converted.currency,
    fxRate: converted.fxRate,
    amountBaseCents: converted.amountBaseCents,
  };
}

const text = (fd: FormData, key: string) => {
  const value = String(fd.get(key) ?? '').trim();
  return value === '' ? null : value;
};

export async function createVehicleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const base = session.agency.baseCurrency as Currency;
  const listPrice = readMoney(fd, 'listPrice', base);
  if (!listPrice) return { error: 'Falta el precio de venta.' };

  const ownership = String(fd.get('ownership')) === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'OWNED';
  const acquisition = readMoney(fd, 'acquisition', base);
  const agreedFloor = readMoney(fd, 'agreedFloor', base);

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
