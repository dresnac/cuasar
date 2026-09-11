import { NextResponse } from 'next/server';
import { drainOutbox } from '@cuasar/integrations';

/**
 * Drena la cola de salida. Lo dispara un cron de Vercel cada cinco minutos.
 *
 * Corre fuera de toda sesión, con el rol dueño: no hay agencia activa, hay
 * mensajes de todas. Por eso está protegido por `CRON_SECRET` y no por auth
 * de usuario.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  // Vercel manda `authorization: Bearer <CRON_SECRET>` en los cron jobs.
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const result = await drainOutbox();
  return NextResponse.json(result);
}

// Un lote puede tocar varios proveedores externos; el default de 300s sobra,
// pero dejarlo explícito evita sorpresas si el lote crece.
export const maxDuration = 60;
