import { NextResponse } from 'next/server';
import {
  applyBillingEvent,
  claimBillingEvent,
  markBillingEventProcessed,
} from '@cuasar/core/services';
import type { BillingProvider } from '@cuasar/core';
import { billingAdapter } from '@cuasar/integrations';

/**
 * Webhooks de cobro. Un solo handler para los dos proveedores: el adapter
 * verifica la firma y normaliza, y de acá para adentro nadie sabe cuál cobró.
 *
 * Qué código devolvemos importa más de lo que parece:
 *
 * - firma inválida → 400, y el proveedor deja de reintentar. Es lo correcto:
 *   nada de lo que mande va a empezar a validar.
 * - evento ya procesado → 200 sin hacer nada.
 * - error al aplicar → 500, para que el proveedor reintente; el evento queda
 *   registrado sin `processed_at` y el reintento vuelve a aplicarlo.
 */
const PROVIDERS: Record<string, BillingProvider> = {
  stripe: 'STRIPE',
  mercadopago: 'MERCADOPAGO',
};

export async function POST(request: Request, ctx: RouteContext<'/api/webhooks/[proveedor]'>) {
  const { proveedor } = await ctx.params;
  const provider = PROVIDERS[proveedor];

  if (!provider) return NextResponse.json({ error: 'Proveedor desconocido' }, { status: 404 });

  const adapter = billingAdapter(provider);
  if (!adapter) {
    return NextResponse.json({ error: 'Proveedor no configurado' }, { status: 503 });
  }

  let providerEventId: string;
  let event;

  try {
    ({ providerEventId, event } = await adapter.parseWebhook(request));
  } catch (error) {
    console.warn('[cuasar:billing] webhook rechazado', { provider, error });
    return NextResponse.json({ error: 'Firma inválida' }, { status: 400 });
  }

  const claim = await claimBillingEvent({
    provider,
    providerEventId,
    type: event.type,
    payload: event,
  });

  if (claim === 'ALREADY_PROCESSED') {
    return NextResponse.json({ ok: true, duplicated: true });
  }

  const applied = await applyBillingEvent(event);

  if (!applied.ok) {
    await markBillingEventProcessed(provider, providerEventId, applied.error.message);

    // Un evento de una suscripción que no conocemos no se arregla
    // reintentando: se marca y se contesta 200 para que el proveedor no
    // insista con algo que nunca vamos a poder aplicar.
    if (applied.error.code === 'NOT_FOUND') {
      return NextResponse.json({ ok: true, ignored: applied.error.message });
    }
    return NextResponse.json({ error: applied.error.message }, { status: 500 });
  }

  await markBillingEventProcessed(provider, providerEventId);
  return NextResponse.json({ ok: true, type: event.type });
}
