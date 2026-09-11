import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Los paquetes del monorepo se publican como TypeScript sin compilar.
  transpilePackages: ['@cuasar/db', '@cuasar/core', '@cuasar/ui'],
  // Los listados construyen su URL desde los filtros activos; con rutas
  // tipadas cada query string necesitaría un cast que no aporta seguridad.
  typedRoutes: false,
  images: {
    // Las fotos viven en Vercel Blob, nunca en la base de datos.
    remotePatterns: [
      { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
      { protocol: 'https', hostname: 'picsum.photos' },
    ],
  },
};

export default nextConfig;
