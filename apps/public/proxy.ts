import { NextResponse, type NextRequest } from 'next/server';
import { resolveAgencyByHost } from '@cuasar/core/services';

/**
 * Dominio → agencia, antes de renderizar nada.
 *
 * Vive en `proxy.ts` y no en `middleware.ts` porque en Next 16 es ese el
 * archivo que corre en Node.js: la resolución consulta Postgres, y el
 * runtime edge no tiene sockets.
 *
 * Resolverlo acá y no adentro de la página tiene dos razones. Una: un host
 * que no es de nadie tiene que contestar 404 de verdad, y con prerender
 * parcial el estado ya viajó cuando la parte dinámica descubre que no hay
 * agencia. La otra: así la página recibe el id resuelto y no repite la
 * consulta en cada request.
 *
 * El mapa vive en memoria del proceso con un TTL corto. Es el mismo rol que
 * cumpliría un store de configuración replicado; si el volumen lo pide,
 * se cambia esta función y el resto del sitio no se entera.
 */
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { agencyId: string | null; expiresAt: number }>();

async function agencyIdFor(host: string): Promise<string | null> {
  const hit = cache.get(host);
  if (hit && hit.expiresAt > Date.now()) return hit.agencyId;

  const agency = await resolveAgencyByHost(host);
  const agencyId = agency?.agencyId ?? null;

  // Los hosts desconocidos también se cachean: si no, cualquiera puede
  // hacernos consultar la base con dominios inventados.
  cache.set(host, { agencyId, expiresAt: Date.now() + TTL_MS });
  return agencyId;
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';

  let agencyId = await agencyIdFor(host);

  if (!agencyId && process.env.NODE_ENV !== 'production' && process.env.DEV_AGENCY_SLUG) {
    const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'cuasar.app';
    agencyId = await agencyIdFor(`${process.env.DEV_AGENCY_SLUG}.${root}`);
  }

  if (!agencyId) {
    return new NextResponse(NOT_FOUND_HTML, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' },
    });
  }

  const headers = new Headers(request.headers);
  headers.set('x-agency-id', agencyId);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // `/api` queda afuera: el backoffice llama a /api/revalidate desde un host
  // que no es el de ninguna agencia, y no tendría que toparse con el 404 de
  // dominio desconocido. El sitemap y el robots sí pasan, porque son
  // distintos para cada agencia.
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|avif|svg|ico)$).*)',
  ],
};

const NOT_FOUND_HTML = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Sitio no encontrado</title>
    <style>
      body { margin:0; min-height:100dvh; display:grid; place-items:center; padding:1.5rem;
             background:#fff; color:#14161a; text-align:center;
             font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
      h1 { font-size:1.5rem; font-weight:600; letter-spacing:-0.02em; margin:0; }
      p  { margin:.5rem 0 0; max-width:30rem; color:#55595f; line-height:1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>No encontramos este sitio</h1>
      <p>El dominio no corresponde a ninguna agencia activa. Si sos el dueño y acabás de
         configurarlo, puede tardar unos minutos en propagarse.</p>
    </main>
  </body>
</html>`;
