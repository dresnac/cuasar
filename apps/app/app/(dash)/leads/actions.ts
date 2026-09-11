'use server';

import { revalidatePath } from 'next/cache';
import {
  anonymizeLead,
  assignLead,
  setLeadStatus,
  type LeadStatus,
} from '@cuasar/core/services';
import { requireSession } from '@/lib/tenant';

export type ActionState = { error?: string };

export async function assignLeadAction(
  leadId: string,
  userId: string | null,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await assignLead(session.ctx, leadId, userId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/leads');
  return {};
}

export async function setLeadStatusAction(
  leadId: string,
  status: LeadStatus,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await setLeadStatus(session.ctx, leadId, status);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/leads');
  return {};
}

export async function anonymizeLeadAction(leadId: string): Promise<ActionState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await anonymizeLead(session.ctx, leadId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/leads');
  return {};
}
