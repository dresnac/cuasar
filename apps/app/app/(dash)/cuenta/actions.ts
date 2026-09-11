'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  attachSubscription,
  changeMemberRole,
  getBillingSummary,
  inviteMember,
  removeMember,
  requestSeatChange,
} from '@cuasar/core/services';
import type { BillingProvider, Role } from '@cuasar/core';
import { billingAdapter } from '@cuasar/integrations';
import { requireSession } from '@/lib/tenant';

export type ActionState = { error?: string; ok?: true; message?: string };

export async function inviteMemberAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await inviteMember(session.ctx, {
    email: fd.get('email'),
    role: fd.get('role'),
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/cuenta');
  return {
    ok: true,
    message: `Invitamos a ${result.data.email}. Entra con ese mail y queda dentro del equipo.`,
  };
}

export async function changeRoleAction(membershipId: string, role: Role): Promise<ActionState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await changeMemberRole(session.ctx, membershipId, role);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/cuenta');
  return {};
}

export async function removeMemberAction(membershipId: string): Promise<ActionState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const result = await removeMember(session.ctx, membershipId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/cuenta');
  return {};
}

export async function changeSeatsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (session.access !== 'FULL') return { error: 'La cuenta está en modo lectura.' };

  const seats = Number(fd.get('seats'));
  if (!Number.isFinite(seats) || seats < 1) return { error: 'Cantidad de asientos inválida.' };

  const result = await requestSeatChange(session.ctx, seats);
  if (!result.ok) return { error: result.error.message };

  // El proveedor se entera después: la fuente de verdad de lo facturado es
  // él, y su webhook va a confirmar el cambio. Si no hay proveedor conectado,
  // el cambio queda local y se sincroniza cuando se conecte.
  const summary = await getBillingSummary(session.ctx);
  if (summary.ok && summary.data.providerSubscriptionId) {
    const adapter = billingAdapter(summary.data.provider);
    if (adapter) {
      try {
        await adapter.updateSeats(summary.data.providerSubscriptionId, seats);
      } catch (error) {
        return {
          error: `Guardamos el cambio, pero el proveedor no lo aceptó: ${
            error instanceof Error ? error.message : 'error desconocido'
          }`,
        };
      }
    }
  }

  revalidatePath('/cuenta');
  return { ok: true, message: `El plan pasa a ${seats} asientos.` };
}

/** Arranca el alta con el proveedor elegido y manda al checkout. */
export async function startCheckoutAction(provider: BillingProvider): Promise<ActionState> {
  const session = await requireSession();
  if (session.access === 'BLOCKED') return { error: 'La cuenta está bloqueada.' };

  const adapter = billingAdapter(provider);
  if (!adapter) {
    return {
      error:
        provider === 'STRIPE'
          ? 'Stripe todavía no está configurado en la plataforma.'
          : 'MercadoPago todavía no está configurado en la plataforma.',
    };
  }

  const summary = await getBillingSummary(session.ctx);
  if (!summary.ok) return { error: summary.error.message };

  let url: string;
  try {
    const created = await adapter.createSubscription({
      agencyId: session.ctx.agencyId,
      agencyName: session.agency.agencyName,
      email: session.user.email,
      planCode: summary.data.planCode,
      seats: summary.data.seatsPurchased,
    });

    await attachSubscription(session.ctx.agencyId, created);
    url = created.checkoutUrl ?? '';
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'No pudimos iniciar el pago.' };
  }

  if (!url) return { error: 'El proveedor no devolvió un link de pago.' };
  redirect(url);
}

export async function openPortalAction(): Promise<ActionState> {
  const session = await requireSession();

  const summary = await getBillingSummary(session.ctx);
  if (!summary.ok) return { error: summary.error.message };
  if (!summary.data.providerCustomerId) return { error: 'Todavía no hay un pago registrado.' };

  const adapter = billingAdapter(summary.data.provider);
  if (!adapter) return { error: 'El proveedor no está configurado.' };

  const url = await adapter.portalUrl(
    summary.data.providerCustomerId,
    `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/cuenta`,
  );
  redirect(url);
}
