'use client';

import { useActionState } from 'react';
import { createAgencyAction, type FormState } from './actions';
import { Alert, Button, Card, Field, Input, Select } from '@/components/ui';

export function AgencyForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createAgencyAction, {});

  return (
    <form action={action} className="mt-6">
      <Card className="flex flex-col gap-4 p-5">
        <Field label="Nombre de la agencia" required>
          <Input name="name" required autoFocus placeholder="Automotores del Sur" />
        </Field>

        <Field
          label="Moneda para tus números"
          hint="en la que querés leer márgenes y capital"
        >
          <Select name="baseCurrency" defaultValue="USD">
            <option value="USD">Dólares (USD)</option>
            <option value="ARS">Pesos (ARS)</option>
          </Select>
        </Field>

        <p className="text-[12px] text-ink-faint">
          Podés cargar operaciones en cualquier moneda: cada una guarda su cotización del día y se
          convierte a esta para los reportes.
        </p>

        {state.error && <Alert tone="stale">{state.error}</Alert>}

        <Button type="submit" disabled={pending} className="self-start">
          {pending ? 'Creando…' : 'Crear agencia'}
        </Button>
      </Card>
    </form>
  );
}
