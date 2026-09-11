'use client';

import { useState, useTransition } from 'react';
import { allowedTransitions, type VehicleStatus } from '@cuasar/core';
import { transitionAction } from '@/app/(dash)/vehiculos/actions';
import { STATUS_META } from './vehicle-meta';
import { Alert, Button } from './ui';

export function TransitionControl({
  vehicleId,
  status,
  disabled,
}: {
  vehicleId: string;
  status: VehicleStatus;
  disabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options = allowedTransitions(status);

  if (options.length === 0) {
    return (
      <p className="text-[12px] text-ink-faint">
        {STATUS_META[status].label} es un estado final. Para revertirlo hace falta un ajuste
        registrado.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((to) => (
          <Button
            key={to}
            variant={to === 'PUBLICADO' ? 'primary' : 'secondary'}
            size="sm"
            disabled={disabled || pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await transitionAction(vehicleId, to);
                if (result?.error) setError(result.error);
              })
            }
          >
            {verbFor(to)}
          </Button>
        ))}
      </div>
      {error && <Alert tone="stale">{error}</Alert>}
    </div>
  );
}

/** El botón dice qué va a pasar, no el nombre del estado destino. */
function verbFor(to: VehicleStatus) {
  switch (to) {
    case 'EN_PREPARACION':
      return 'Mandar a preparación';
    case 'PUBLICADO':
      return 'Publicar';
    case 'RESERVADO':
      return 'Marcar reservado';
    case 'VENDIDO':
      return 'Marcar vendido';
    case 'PAUSADO':
      return 'Pausar';
    case 'DEVUELTO':
      return 'Devolver al dueño';
    case 'BAJA':
      return 'Dar de baja';
    default:
      return STATUS_META[to].label;
  }
}
