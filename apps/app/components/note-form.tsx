'use client';

import { useActionState } from 'react';
import { addNoteAction, type FormState } from '@/app/(dash)/vehiculos/actions';
import { Alert, Button, Textarea } from './ui';

export function NoteForm({ vehicleId, disabled }: { vehicleId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    addNoteAction.bind(null, vehicleId),
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-2">
      <Textarea
        name="note"
        rows={2}
        required
        disabled={disabled || pending}
        placeholder="Qué pasó con esta unidad"
        className="text-[13px]"
      />
      {state.error && <Alert tone="stale">{state.error}</Alert>}
      <Button type="submit" size="sm" variant="secondary" disabled={disabled || pending} className="self-start">
        {pending ? 'Guardando…' : 'Agregar al historial'}
      </Button>
    </form>
  );
}
