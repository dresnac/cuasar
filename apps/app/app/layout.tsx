import type { Metadata } from 'next';
import { Archivo, Familjen_Grotesk } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { esES } from '@clerk/localizations';
import './globals.css';

const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
});

const familjen = Familjen_Grotesk({
  subsets: ['latin'],
  variable: '--font-familjen',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Cuasar', template: '%s · Cuasar' },
  description: 'Gestión de stock, contabilidad y catálogo para concesionarios.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <ClerkProvider
      localization={esES}
      signInUrl="/ingresar"
      signUpUrl="/crear-cuenta"
      signInFallbackRedirectUrl="/vehiculos"
      signUpFallbackRedirectUrl="/alta-agencia"
    >
      <html lang="es" className={`${archivo.variable} ${familjen.variable}`}>
        <body className="min-h-dvh bg-paper text-ink">{children}</body>
      </html>
    </ClerkProvider>
  );
}
