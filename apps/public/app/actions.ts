'use server';

import { createPublicLead } from '@cuasar/core/services';
import { currentAgency } from '@/lib/agency';

export type LeadState = { ok?: true; error?: string };

export async function sendLeadAction(
  vehicleSlug: string | null,
  _prev: LeadState,
  fd: FormData,
): Promise<LeadState> {
  const agency = await currentAgency();
  if (!agency) return { error: 'No pudimos identificar la agencia.' };

  // Campo señuelo: está oculto para una persona y visible para un bot que
  // completa todo lo que encuentra. Si viene lleno, contestamos como si
  // hubiera salido bien y no escribimos nada.
  if (String(fd.get('empresa') ?? '')) return { ok: true };

  const result = await createPublicLead(agency.agencyId, {
    name: fd.get('name'),
    email: fd.get('email'),
    phone: fd.get('phone'),
    message: fd.get('message'),
    vehicleSlug: vehicleSlug ?? undefined,
  });

  if (!result.ok) return { error: result.error.message };
  return { ok: true };
}
