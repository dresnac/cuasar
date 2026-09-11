'use server';

import { revalidatePath } from 'next/cache';
import { setAgencyStatus, type AgencyStatus } from '@cuasar/core/services';
import { currentLocalUser } from '@/lib/tenant';

export type ActionState = { error?: string; ok?: true };

export async function setAgencyStatusAction(
  agencyId: string,
  status: AgencyStatus,
  reason: string,
): Promise<ActionState> {
  const user = await currentLocalUser();

  const result = await setAgencyStatus(user.id, agencyId, status, reason);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/plataforma');
  return { ok: true };
}
