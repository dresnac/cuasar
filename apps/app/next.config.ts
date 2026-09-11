import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Los paquetes del monorepo se publican como TypeScript sin compilar.
  transpilePackages: ['@cuasar/db', '@cuasar/core', '@cuasar/ui'],
  images: {
    // Las fotos viven en Vercel Blob, nunca en la base de datos.
    remotePatterns: [
      { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
      { protocol: 'https', hostname: 'picsum.photos' },
    ],
  },
  typedRoutes: true,
};

export default nextConfig;
