import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { vehicleBelongsToAgency } from '@cuasar/core/services';
import { requireSession } from '@/lib/tenant';

/**
 * Emite un token para que el navegador suba directo a Blob.
 *
 * Las fotos no pasan por la función: un patio sube 40 imágenes por unidad y
 * hacerlas viajar por el servidor es pagar dos veces por el mismo byte.
 * Lo que sí valida el servidor es a qué agencia pertenece el vehículo,
 * antes de firmar nada.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await requireSession();
        if (session.access !== 'FULL') throw new Error('La cuenta está en modo lectura.');

        const vehicleId = String(clientPayload ?? '');
        if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) throw new Error('Vehículo inválido.');

        const belongs = await vehicleBelongsToAgency(session.ctx, vehicleId);
        if (!belongs) throw new Error('Ese vehículo no es de esta agencia.');

        // La ruta lleva la agencia adelante: hace el storage auditable y
        // permite borrar todo lo de una cuenta dada de baja con un prefijo.
        if (!pathname.startsWith(`${session.agency.agencySlug}/${vehicleId}/`)) {
          throw new Error('Ruta de archivo inválida.');
        }

        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
          maximumSizeInBytes: 12 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ agencyId: session.ctx.agencyId, vehicleId }),
        };
      },
      onUploadCompleted: async () => {
        // La fila en vehicle_images la escribe la server action, no este
        // callback: en desarrollo Vercel no puede alcanzar localhost y el
        // callback nunca llega. La verdad está en la base, no en el webhook.
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'No se pudo subir el archivo' },
      { status: 400 },
    );
  }
}
