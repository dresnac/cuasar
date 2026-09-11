import { myMemberships } from '@/lib/tenant';
import { redirect } from 'next/navigation';
import { AgencyForm } from './form';

export const metadata = { title: 'Crear agencia' };

export default async function Page() {
  const memberships = await myMemberships();
  if (memberships.length > 0) redirect('/vehiculos');

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Creá tu agencia</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          Es el espacio donde van a vivir tu stock, tu contabilidad y tu sitio público. Podés
          invitar a tu equipo después.
        </p>
        <AgencyForm />
      </div>
    </div>
  );
}
