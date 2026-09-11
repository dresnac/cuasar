import { VehicleForm } from '@/components/vehicle-form';
import { requireSession } from '@/lib/tenant';

export const metadata = { title: 'Cargar vehículo' };

export default async function NewVehiclePage() {
  const session = await requireSession();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Cargar vehículo</h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Entra como <strong className="font-medium">Ingresado</strong>. Después cargás las fotos y
          lo publicás.
        </p>
      </header>

      <VehicleForm baseCurrency={session.agency.baseCurrency} />
    </div>
  );
}
