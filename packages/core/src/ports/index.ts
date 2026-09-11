/**
 * Puertos de integración.
 *
 * v1 define las interfaces y no implementa ningún adapter. Nada del dominio
 * importa un SDK de tercero: escribe en `outbox` dentro de la misma
 * transacción que el cambio, y un worker drena esa tabla y llama al adapter.
 *
 * Conectar MercadoLibre mañana = escribir un adapter + una pantalla de OAuth.
 * Sin tocar el core.
 */
export type RemoteRef = { provider: string; remoteId: string };

export type PortCtx = { agencyId: string; connectionId: string };

export type PublishableVehicle = {
  id: string;
  brand: string;
  model: string;
  version: string | null;
  year: number;
  km: number;
  priceCents: bigint;
  currency: string;
  description: string | null;
  images: readonly string[];
};

export interface ListingPort {
  publish(ctx: PortCtx, vehicle: PublishableVehicle): Promise<RemoteRef>;
  update(ctx: PortCtx, ref: RemoteRef, vehicle: PublishableVehicle): Promise<void>;
  unpublish(ctx: PortCtx, ref: RemoteRef): Promise<void>;
  pullLeads(ctx: PortCtx, since: Date): Promise<InboundLead[]>;
}

export type InboundLead = {
  remoteId: string;
  vehicleRemoteId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  receivedAt: Date;
};

export type SchedulableAppointment = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  attendeeEmail: string | null;
  notes: string | null;
};

export type BusySlot = { startsAt: Date; endsAt: Date };

export interface CalendarPort {
  push(ctx: PortCtx, appointment: SchedulableAppointment): Promise<RemoteRef>;
  cancel(ctx: PortCtx, ref: RemoteRef): Promise<void>;
  pullBusy(ctx: PortCtx, range: { from: Date; to: Date }): Promise<BusySlot[]>;
}

export * from './billing';
