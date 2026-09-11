import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { agencyTag } from '@/lib/agency';
import { catalogTag } from '@/lib/catalog';

/**
 * Invalidación del catálogo, llamada por el backoffice.
 *
 * El sitio público y el backoffice son dos despliegues separados —a
 * propósito: tienen perfiles de caché opuestos— así que `revalidateTag` en
 * uno no alcanza al otro. Este endpoint es el puente.
 *
 * Sin esto, publicar un auto o bajarle el precio no se vería en el sitio
 * hasta que venciera el TTL, y un precio desactualizado en el catálogo no es
 * un problema técnico: es un problema comercial.
 */
export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Sin secreto configurado' }, { status: 500 });
  }

  if (request.headers.get('x-cuasar-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { agencyId?: string } | null;
  const agencyId = body?.agencyId;

  if (!agencyId || !/^[0-9a-f-]{36}$/i.test(agencyId)) {
    return NextResponse.json({ error: 'agencyId inválido' }, { status: 400 });
  }

  // `{ expire: 0 }` en vez del recomendado "max": el primer request después
  // de un cambio bloquea y revalida, en lugar de servir contenido viejo
  // mientras tanto. Un precio desactualizado en el catálogo es un problema
  // comercial, así que acá la corrección vale más que esos milisegundos.
  revalidateTag(catalogTag(agencyId), { expire: 0 });
  revalidateTag(agencyTag(agencyId), { expire: 0 });

  return NextResponse.json({ ok: true, revalidated: [catalogTag(agencyId), agencyTag(agencyId)] });
}
