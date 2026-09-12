'use server';

import { checkBotId } from 'botid/server';
import { headers } from 'next/headers';
import { createPublicLead } from '@cuasar/core/services';
import { clientIp, rateLimit, RULES } from '@cuasar/integrations';
import { currentAgency } from '@/lib/agency';
import { drainAfterResponse } from '@/lib/notify';

export type LeadState = { ok?: true; error?: string };

export async function sendLeadAction(
  vehicleSlug: string | null,
  _prev: LeadState,
  fd: FormData,
): Promise<LeadState> {
  const agency = await currentAgency();
  if (!agency) return { error: 'No pudimos identificar la agencia.' };

  // Dos límites en capas: por IP acá —para que nadie inunde el formulario— y
  // por teléfono en la base, que es el durable y no depende de ningún caché.
  const ip = clientIp(await headers());
  const allowed = await rateLimit(`lead:${agency.agencyId}:${ip}`, RULES.publicLead);

  if (!allowed.ok) {
    return { error: 'Recibimos varias consultas tuyas. Probá de nuevo más tarde.' };
  }

  // Tres capas contra el spam, de la más barata a la más precisa:
  // el señuelo, la verificación de BotID y el límite por IP.
  //
  // El señuelo está oculto para una persona y visible para un bot que
  // completa todo lo que encuentra. Si viene lleno, contestamos como si
  // hubiera salido bien y no escribimos nada: un bot que recibe un error
  // reintenta, uno que recibe un éxito se va.
  if (String(fd.get('empresa') ?? '')) return { ok: true };

  const verification = await checkBotId();
  if (verification.isBot) return { ok: true };

  const result = await createPublicLead(agency.agencyId, {
    name: fd.get('name'),
    email: fd.get('email'),
    phone: fd.get('phone'),
    message: fd.get('message'),
    vehicleSlug: vehicleSlug ?? undefined,
  });

  if (!result.ok) return { error: result.error.message };

  drainAfterResponse();
  return { ok: true };
}
