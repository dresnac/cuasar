import { BotIdClient } from 'botid/client';
import { Archivo, Familjen_Grotesk } from 'next/font/google';
import './globals.css';

/**
 * Qué rutas verifica BotID. Son las que escriben: el resto del sitio es
 * lectura y queremos que la indexe cualquier buscador.
 */
const PROTECTED = [{ path: '/', method: 'POST' }, { path: '/u/*', method: 'POST' }];

const archivo = Archivo({ subsets: ['latin'], variable: '--font-archivo', display: 'swap' });
const familjen = Familjen_Grotesk({
  subsets: ['latin'],
  variable: '--font-familjen',
  display: 'swap',
});

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es" className={`${archivo.variable} ${familjen.variable}`}>
      <head>
        <BotIdClient protect={PROTECTED} />
      </head>
      <body className="min-h-dvh bg-paper text-ink">{children}</body>
    </html>
  );
}
