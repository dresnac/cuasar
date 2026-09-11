import { SignOutButton } from '@clerk/nextjs';
import { buttonClass } from '@/components/ui';

export const metadata = { title: 'Cuenta sin acceso' };

export default function Page() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Esta cuenta no tiene acceso
        </h1>
        <p className="mt-2 text-[14px] text-ink-soft">
          La suscripción está cancelada o la agencia fue suspendida. Tus datos se conservan 90 días.
          Escribinos a soporte@cuasar.app para reactivarla.
        </p>
        <div className="mt-6">
          <SignOutButton>
            <button className={buttonClass('secondary')}>Cerrar sesión</button>
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}
