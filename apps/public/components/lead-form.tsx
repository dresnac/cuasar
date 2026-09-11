'use client';

import { useActionState } from 'react';
import { sendLeadAction, type LeadState } from '@/app/actions';

export function LeadForm({
  vehicleSlug,
  vehicleName,
}: {
  vehicleSlug: string | null;
  vehicleName?: string;
}) {
  const [state, action, pending] = useActionState<LeadState, FormData>(
    sendLeadAction.bind(null, vehicleSlug),
    {},
  );

  if (state.ok) {
    return (
      <div className="rounded-xl border border-line bg-muted p-5">
        <p className="font-display text-[17px] font-semibold tracking-tight">Consulta enviada</p>
        <p className="mt-1 text-[14px] text-ink-soft">
          Te van a contactar al teléfono que dejaste. Si es urgente, llamanos.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="rounded-xl border border-line p-5">
      <p className="font-display text-[17px] font-semibold tracking-tight">
        {vehicleName ? `Consultar por este ${vehicleName}` : 'Escribinos'}
      </p>
      <p className="mt-1 text-[14px] text-ink-soft">
        Dejanos un teléfono y te contestamos.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <Input name="name" label="Nombre" required autoComplete="name" />
        <Input name="phone" label="Teléfono" required type="tel" autoComplete="tel" />
        <Input name="email" label="Mail" hint="opcional" type="email" autoComplete="email" />

        <label className="block">
          <span className="mb-1 block text-[13px] font-medium">Mensaje</span>
          <textarea
            name="message"
            rows={3}
            defaultValue={vehicleName ? `Hola, me interesa el ${vehicleName}.` : ''}
            className="w-full rounded-lg border border-line-strong px-3 py-2.5 text-[15px] focus:border-[var(--brand)] focus:outline-none"
          />
        </label>

        {/* Señuelo para bots. Oculto de la vista y del lector de pantalla. */}
        <input
          type="text"
          name="empresa"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          className="absolute size-0 overflow-hidden opacity-0"
        />

        {state.error && (
          <p role="alert" className="text-[13px] text-[#b3402f]">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-lg text-[15px] font-medium text-white transition-opacity disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {pending ? 'Enviando…' : 'Enviar consulta'}
        </button>
      </div>
    </form>
  );
}

function Input({
  name,
  label,
  hint,
  ...props
}: { name: string; label: string; hint?: string } & React.ComponentProps<'input'>) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-1.5 text-[13px] font-medium">
        {label}
        {hint && <span className="font-normal text-ink-faint">{hint}</span>}
      </span>
      <input
        name={name}
        className="h-11 w-full rounded-lg border border-line-strong px-3 text-[15px] focus:border-[var(--brand)] focus:outline-none"
        {...props}
      />
    </label>
  );
}
