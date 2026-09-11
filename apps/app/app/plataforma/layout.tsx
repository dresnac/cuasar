import Link from 'next/link';
import { notFound } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { getPlatformAdmin } from '@cuasar/core/services';
import { currentLocalUser } from '@/lib/tenant';

export const metadata = { title: 'Plataforma' };

/**
 * El panel de moderadores.
 *
 * Deliberadamente fuera del layout de agencia: acá no hay agencia activa, no
 * hay selector y no se ven datos operativos. Quien no está en
 * `platform_admins` recibe un 404, no un "no tenés permiso": que exista esta
 * sección no es información que una agencia necesite.
 */
export default async function PlatformLayout({ children }: LayoutProps<'/plataforma'>) {
  const user = await currentLocalUser();
  const admin = await getPlatformAdmin(user.id);

  if (!admin) notFound();

  return (
    <div className="min-h-dvh bg-ink text-paper">
      <header className="border-b border-paper/10">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-3">
          <Link href="/plataforma" className="flex items-baseline gap-2">
            <span className="font-display text-[16px] font-semibold tracking-tight">Cuasar</span>
            <span className="text-[12px] uppercase tracking-[0.16em] text-paper/50">
              Plataforma
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <span className="text-[12px] text-paper/60">
              {admin.name ?? 'Moderador'} · {admin.level === 'ADMIN' ? 'administrador' : 'soporte'}
            </span>
            <Link href="/vehiculos" className="text-[12px] text-paper/60 hover:text-paper">
              Ir al backoffice
            </Link>
            <UserButton appearance={{ elements: { avatarBox: 'size-7' } }} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-7">{children}</main>
    </div>
  );
}
