import { withBotId } from 'botid/next/config';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Los paquetes del monorepo se publican como TypeScript sin compilar.
  transpilePackages: ['@cuasar/db', '@cuasar/core', '@cuasar/ui', '@cuasar/integrations'],
  // Los listados construyen su URL desde los filtros activos; con rutas
  // tipadas cada query string necesitaría un cast que no aporta seguridad.
  typedRoutes: false,
  // El catálogo se sirve cacheado y se invalida por tag cuando una agencia
  // publica: `use cache` es lo que hace que un pico de tráfico público no
  // se traduzca en un pico de consultas a la base.
  cacheComponents: true,
  images: {
    // Las fotos viven en Vercel Blob, nunca en la base de datos.
    remotePatterns: [
      { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
      { protocol: 'https', hostname: 'picsum.photos' },
    ],
  },
};

/**
 * BotID protege el formulario público. Es la única superficie del sistema que
 * un bot puede golpear sin credenciales, y el costo de que la inunde no es
 * técnico: es una bandeja de consultas llena de basura en la que se pierde la
 * que sí era una persona.
 */
export default withBotId(nextConfig);
