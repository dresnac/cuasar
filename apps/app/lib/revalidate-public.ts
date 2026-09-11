import 'server-only';

/**
 * Avisale al sitio público que el catálogo de esta agencia cambió.
 *
 * Los dos despliegues están separados, así que la invalidación viaja por
 * HTTP. Nunca hace fallar la operación que la disparó: si el sitio público
 * está caído, el vehículo igual quedó publicado en la base, y el TTL del
 * caché lo va a alcanzar solo. Lo que no puede pasar es que el usuario vea
 * un error al publicar porque otro servicio no contestó.
 */
export async function revalidatePublicCatalog(agencyId: string): Promise<void> {
  const url = process.env.PUBLIC_SITE_URL;
  const secret = process.env.REVALIDATE_SECRET;

  if (!url || !secret) return;

  try {
    await fetch(`${url}/api/revalidate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cuasar-secret': secret },
      body: JSON.stringify({ agencyId }),
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    console.warn('[cuasar] no se pudo invalidar el catálogo público', { agencyId, error });
  }
}
