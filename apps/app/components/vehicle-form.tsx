'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { createVehicleAction, type FormState } from '@/app/(dash)/vehiculos/actions';
import { Alert, Button, Card, Field, Input, Select, SectionTitle, Textarea, buttonClass } from './ui';

const FUELS = [
  ['', 'Sin especificar'],
  ['NAFTA', 'Nafta'],
  ['DIESEL', 'Diésel'],
  ['GNC', 'GNC'],
  ['HIBRIDO', 'Híbrido'],
  ['ELECTRICO', 'Eléctrico'],
] as const;

export function VehicleForm({ baseCurrency }: { baseCurrency: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createVehicleAction, {});
  const [ownership, setOwnership] = useState<'OWNED' | 'CONSIGNMENT'>('OWNED');
  const [currency, setCurrency] = useState(baseCurrency);

  // El tipo de cambio solo aparece cuando hace falta: si la operación es en
  // la moneda de la agencia no hay nada que convertir, y un campo de más
  // en un formulario largo es una pregunta que alguien va a contestar mal.
  const needsFx = currency !== baseCurrency;

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-5">
      <Card className="p-5">
        <SectionTitle eyebrow="Paso 1">Qué unidad es</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marca" required>
            <Input name="brand" required autoFocus placeholder="Toyota" />
          </Field>
          <Field label="Modelo" required>
            <Input name="model" required placeholder="Corolla" />
          </Field>
          <Field label="Versión" hint="opcional">
            <Input name="version" placeholder="XEI 2.0 CVT" />
          </Field>
          <Field label="Patente" hint="opcional">
            <Input name="licensePlate" placeholder="AB123CD" className="uppercase" />
          </Field>
          <Field label="Año" required>
            <Input name="year" type="number" required min={1950} max={2030} placeholder="2021" />
          </Field>
          <Field label="Kilómetros">
            <Input name="km" type="number" min={0} defaultValue={0} />
          </Field>
          <Field label="Combustible">
            <Select name="fuel" defaultValue="">
              {FUELS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Transmisión">
            <Select name="transmission" defaultValue="">
              <option value="">Sin especificar</option>
              <option value="MANUAL">Manual</option>
              <option value="AUTOMATICA">Automática</option>
            </Select>
          </Field>
          <Field label="Color">
            <Input name="color" placeholder="Gris plata" />
          </Field>
          <Field label="Puertas">
            <Input name="doors" type="number" min={2} max={7} />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle eyebrow="Paso 2">Cómo entró al patio</SectionTitle>

        <div className="mb-4 flex gap-2">
          {(
            [
              ['OWNED', 'Propio', 'La agencia compró la unidad'],
              ['CONSIGNMENT', 'Consignación', 'El auto es de un tercero'],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={`flex-1 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                ownership === value
                  ? 'border-ink bg-paper'
                  : 'border-line-strong hover:border-ink/40'
              }`}
            >
              <input
                type="radio"
                name="ownership"
                value={value}
                checked={ownership === value}
                onChange={() => setOwnership(value)}
                className="sr-only"
              />
              <span className="block text-[13px] font-medium">{label}</span>
              <span className="block text-[12px] text-ink-soft">{hint}</span>
            </label>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Precio de venta" required className="sm:col-span-2">
            <Input name="listPriceAmount" required inputMode="decimal" placeholder="24500" />
          </Field>
          <Field label="Moneda" hint="de toda la operación">
            <Select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="USD">USD</option>
              <option value="ARS">ARS</option>
            </Select>
          </Field>

          {needsFx && (
            <Field
              label="Cotización"
              hint={`${currency} por 1 ${baseCurrency}, congelada en esta operación`}
              required
              className="sm:col-span-3"
            >
              <Input name="fxRate" required inputMode="decimal" placeholder="1450.50" />
            </Field>
          )}

          {ownership === 'OWNED' ? (
            <>
              <Field label="Precio de compra" required className="sm:col-span-3">
                <Input name="acquisitionAmount" required inputMode="decimal" placeholder="21000" />
              </Field>
            </>
          ) : (
            <>
              <Field label="Dueño del vehículo" required className="sm:col-span-2">
                <Input name="consignorName" required placeholder="Ricardo Méndez" />
              </Field>
              <Field label="Teléfono">
                <Input name="consignorPhone" placeholder="+54 9 11 …" />
              </Field>
              <Field label="Piso acordado" required className="sm:col-span-3">
                <Input name="agreedFloorAmount" required inputMode="decimal" placeholder="28000" />
              </Field>
              <Field label="Comisión">
                <Select name="commissionType" defaultValue="PCT">
                  <option value="PCT">Porcentaje</option>
                  <option value="FIXED">Monto fijo</option>
                </Select>
              </Field>
              <Field label="Valor" hint="5 = 5%" required className="sm:col-span-2">
                <Input name="commissionValue" required inputMode="decimal" placeholder="5" />
              </Field>
              <Field label="Inicio del contrato" className="sm:col-span-2">
                <Input
                  name="contractStartsAt"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </Field>
              <Field label="Vencimiento" hint="opcional">
                <Input name="contractEndsAt" type="date" />
              </Field>
            </>
          )}

          <Field label="Fecha de ingreso" className="sm:col-span-2">
            <Input
              name="acquiredAt"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle eyebrow="Paso 3">Cómo se publica</SectionTitle>
        <div className="grid gap-4">
          <Field label="Descripción" hint="lo que ve el comprador">
            <Textarea name="description" placeholder="Unidad revisada, service al día…" />
          </Field>
          <Field label="Equipamiento" hint="separado por comas">
            <Input name="features" placeholder="Bluetooth, cámara de retroceso, control de estabilidad" />
          </Field>
        </div>
        <p className="mt-3 text-[12px] text-ink-faint">
          Las fotos se cargan en la ficha, después de guardar. Sin fotos y sin precio, la unidad no
          se puede publicar.
        </p>
      </Card>

      {state.error && <Alert tone="stale">{state.error}</Alert>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar e ir a las fotos'}
        </Button>
        <Link href="/vehiculos" className={buttonClass('ghost')}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
