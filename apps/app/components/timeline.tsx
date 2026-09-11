import type { TimelineEntry } from '@cuasar/core/services';
import { dateTime } from '@/lib/format';

/**
 * El timeline en palabras. Cada evento se cuenta como se lo contaría alguien
 * del patio: qué pasó, a qué valor, quién lo hizo. Nada de nombres de
 * enums en pantalla.
 */
function describe(entry: TimelineEntry): { title: string; detail?: string } {
  const p = entry.payload as Record<string, string | number | undefined>;

  switch (entry.type) {
    case 'VEHICLE_CREATED':
      return {
        title: 'Ingresó al patio',
        detail: p.ownership === 'CONSIGNMENT' ? 'En consignación' : 'Compra propia',
      };
    case 'STATUS_CHANGED':
      return { title: `Pasó a ${labelOf(String(p.to))}`, detail: `Antes: ${labelOf(String(p.from))}` };
    case 'PRICE_CHANGED':
      return {
        title: 'Cambió el precio de venta',
        detail: `${fmt(p.from, p.currency)} → ${fmt(p.to, p.currency)}`,
      };
    case 'IMAGES_ADDED':
      return { title: `Se agregaron ${p.count} fotos` };
    case 'IMAGES_REMOVED':
      return { title: 'Se quitó una foto' };
    case 'COST_REGISTERED':
      return { title: 'Se registró un gasto', detail: String(p.description ?? '') };
    case 'ACQUISITION_REGISTERED':
      return { title: 'Se registró la compra' };
    case 'PUBLISHED':
      return { title: 'Se publicó en el sitio' };
    case 'UNPUBLISHED':
      return { title: 'Salió del sitio' };
    case 'SOLD':
      return { title: 'Se vendió' };
    case 'LEAD_RECEIVED':
      return { title: 'Llegó una consulta' };
    case 'APPOINTMENT_SCHEDULED':
      return { title: 'Se agendó una visita' };
    case 'NOTE_ADDED':
      return { title: 'Nota', detail: String(p.note ?? '') };
    case 'VEHICLE_UPDATED': {
      const changes = (p.changes ?? {}) as unknown as Record<string, unknown>;
      const fields = Object.keys(changes);
      return {
        title: 'Se editó la ficha',
        detail: fields.length ? fields.map(fieldLabel).join(', ') : undefined,
      };
    }
    default:
      return { title: entry.type.toLowerCase().replace(/_/g, ' ') };
  }
}

const STATUS_WORDS: Record<string, string> = {
  INGRESADO: 'ingresado',
  EN_PREPARACION: 'preparación',
  PUBLICADO: 'publicado',
  RESERVADO: 'reservado',
  VENDIDO: 'vendido',
  PAUSADO: 'pausado',
  DEVUELTO: 'devuelto',
  BAJA: 'baja',
};
const labelOf = (s: string) => STATUS_WORDS[s] ?? s.toLowerCase();

const FIELD_WORDS: Record<string, string> = {
  km: 'kilometraje',
  color: 'color',
  description: 'descripción',
  licensePlate: 'patente',
  version: 'versión',
  year: 'año',
  floorPriceCents: 'piso de negociación',
};
const fieldLabel = (f: string) => FIELD_WORDS[f] ?? f;

const fmt = (value: unknown, currency: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: String(currency ?? 'USD'),
    maximumFractionDigits: 0,
  }).format(n / 100);
};

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="px-4 py-6 text-[13px] text-ink-soft">Todavía no pasó nada con esta unidad.</p>;
  }

  return (
    <ol className="relative pl-4">
      <span
        aria-hidden
        className="absolute bottom-3 left-[5px] top-3 w-px bg-line"
      />
      {entries.map((entry) => {
        const { title, detail } = describe(entry);
        return (
          <li key={entry.id} className="relative py-2.5 pl-4">
            <span
              aria-hidden
              className="absolute left-[-3px] top-[15px] size-[7px] rounded-full border-2 border-surface bg-line-strong"
            />
            <p className="text-[13px] font-medium leading-snug">{title}</p>
            {detail && <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{detail}</p>}
            <p className="tabular mt-1 text-[11px] text-ink-faint">
              {dateTime(entry.occurredAt)}
              {entry.actorName && ` · ${entry.actorName}`}
              {entry.source === 'SYSTEM' && ' · automático'}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
