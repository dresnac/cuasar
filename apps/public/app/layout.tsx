import { Archivo, Familjen_Grotesk } from 'next/font/google';
import './globals.css';

const archivo = Archivo({ subsets: ['latin'], variable: '--font-archivo', display: 'swap' });
const familjen = Familjen_Grotesk({
  subsets: ['latin'],
  variable: '--font-familjen',
  display: 'swap',
});

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es" className={`${archivo.variable} ${familjen.variable}`}>
      <body className="min-h-dvh bg-paper text-ink">{children}</body>
    </html>
  );
}
