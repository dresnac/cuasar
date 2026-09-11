import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  schema,
  sql,
  withTenant,
  type TenantCtx,
} from '@cuasar/db';
import { z } from 'zod';
import { fail, ok, type Result } from '../errors';
import { can } from '../permissions';
import { appendEvent } from './_tx';

const { leads, users, vehicles } = schema;

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * La bandeja de consultas.
 *
 * Regla de visibilidad: un vendedor ve las consultas sin dueño —para poder
 * tomarlas— y las suyas. Las de otro vendedor no. No es una restricción de
 * seguridad sino de producto: una bandeja compartida donde todos ven todo
 * termina con dos personas llamando al mismo interesado.
 */
function visibilityClause(ctx: TenantCtx) {
  if (can(ctx.role, 'member:manage')) return undefined;
  return or(isNull(leads.assignedTo), eq(leads.assignedTo, ctx.userId));
}

export const leadFilters = z.object({
  status: z.array(z.enum(LEAD_STATUSES)).optional(),
  assignedTo: z.string().uuid().or(z.literal('unassigned')).optional(),
  vehicleId: z.string().uuid().optional(),
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type LeadRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  source: string;
  status: LeadStatus;
  createdAt: Date;
  assignedTo: string | null;
  assigneeName: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  appointmentAt: Date | null;
};

export async function listLeads(ctx: TenantCtx, raw: unknown): Promise<Result<LeadRow[]>> {
  if (!can(ctx.role, 'lead:read')) return fail('FORBIDDEN', 'No podés ver las consultas.');

  const parsed = leadFilters.safeParse(raw ?? {});
  if (!parsed.success) return fail('VALIDATION', 'Filtros inválidos.');
  const f = parsed.data;

  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({
        id: leads.id,
        name: leads.name,
        email: leads.email,
        phone: leads.phone,
        message: leads.message,
        source: leads.source,
        status: leads.status,
        createdAt: leads.createdAt,
        assignedTo: leads.assignedTo,
        assigneeName: users.name,
        vehicleId: leads.vehicleId,
        brand: vehicles.brand,
        model: vehicles.model,
        year: vehicles.year,
        appointmentAt: sql<Date | null>`(
          select min(a.starts_at) from appointments a
          where a.lead_id = "leads"."id" and a.status in ('SCHEDULED','CONFIRMED')
        )`.as('next_appointment_at'),
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.assignedTo))
      .leftJoin(vehicles, eq(vehicles.id, leads.vehicleId))
      .where(
        and(
          visibilityClause(ctx),
          f.status?.length ? inArray(leads.status, f.status) : undefined,
          f.assignedTo === 'unassigned'
            ? isNull(leads.assignedTo)
            : f.assignedTo
              ? eq(leads.assignedTo, f.assignedTo)
              : undefined,
          f.vehicleId ? eq(leads.vehicleId, f.vehicleId) : undefined,
          f.q ? or(ilike(leads.name, `%${f.q}%`), ilike(leads.phone, `%${f.q}%`)) : undefined,
        ),
      )
      // Lo más nuevo primero: en una consulta de un auto usado, la primera
      // hora es la que define si el interesado sigue interesado.
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(f.limit),
  );

  return ok(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      message: r.message,
      source: r.source,
      status: r.status as LeadStatus,
      createdAt: r.createdAt,
      assignedTo: r.assignedTo,
      assigneeName: r.assigneeName,
      vehicleId: r.vehicleId,
      vehicleLabel: r.brand ? `${r.brand} ${r.model} ${r.year}` : null,
      appointmentAt: r.appointmentAt,
    })),
  );
}

/** Cuántas hay sin atender, para el badge de la barra lateral. */
export async function countNewLeads(ctx: TenantCtx): Promise<number> {
  if (!can(ctx.role, 'lead:read')) return 0;

  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ n: count() })
      .from(leads)
      .where(and(visibilityClause(ctx), eq(leads.status, 'NEW')));
    return Number(row?.n ?? 0);
  });
}

export async function assignLead(
  ctx: TenantCtx,
  leadId: string,
  userId: string | null,
): Promise<Result<true>> {
  if (!can(ctx.role, 'lead:write')) return fail('FORBIDDEN', 'No podés asignar consultas.');

  return withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({ assignedTo: leads.assignedTo })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);

    if (!current) return fail<true>('NOT_FOUND', 'La consulta no existe.');

    // Un vendedor puede tomar una consulta libre, o soltar la suya. Lo que no
    // puede es sacarle una consulta a un compañero.
    if (!can(ctx.role, 'member:manage')) {
      const mine = current.assignedTo === ctx.userId;
      const free = current.assignedTo === null;
      const takingForSelf = userId === ctx.userId || userId === null;

      if (!((free || mine) && takingForSelf)) {
        return fail<true>('FORBIDDEN', 'Esa consulta ya la está atendiendo otra persona.');
      }
    }

    await tx.update(leads).set({ assignedTo: userId }).where(eq(leads.id, leadId));
    return ok(true as const);
  });
}

export async function setLeadStatus(
  ctx: TenantCtx,
  leadId: string,
  status: LeadStatus,
): Promise<Result<true>> {
  if (!can(ctx.role, 'lead:write')) return fail('FORBIDDEN', 'No podés cambiar el estado.');

  return withTenant(ctx, async (tx) => {
    const [updated] = await tx
      .update(leads)
      .set({ status })
      .where(and(eq(leads.id, leadId), visibilityClause(ctx) ?? sql`true`))
      .returning({ id: leads.id, vehicleId: leads.vehicleId });

    if (!updated) return fail<true>('NOT_FOUND', 'La consulta no existe o no es tuya.');

    // Que una consulta termine en venta es parte de la historia del vehículo.
    if (updated.vehicleId && (status === 'WON' || status === 'LOST')) {
      await appendEvent(tx, ctx, {
        vehicleId: updated.vehicleId,
        type: 'NOTE_ADDED',
        payload: {
          note: status === 'WON' ? 'Una consulta terminó en venta.' : 'Una consulta se perdió.',
          leadId,
        },
      });
    }

    return ok(true as const);
  });
}

/**
 * Borra los datos de contacto sin romper el historial.
 *
 * El timeline referencia al lead por id, nunca copia el nombre ni el
 * teléfono, así que anonimizar la fila deja los eventos intactos y la
 * contabilidad de "cuántas consultas entraron" también.
 */
export async function anonymizeLead(ctx: TenantCtx, leadId: string): Promise<Result<true>> {
  if (!can(ctx.role, 'member:manage')) {
    return fail('FORBIDDEN', 'Solo un administrador puede borrar datos de contacto.');
  }

  return withTenant(ctx, async (tx) => {
    const [updated] = await tx
      .update(leads)
      .set({
        name: 'Consulta anonimizada',
        email: null,
        phone: null,
        message: null,
        anonymizedAt: new Date(),
      })
      .where(eq(leads.id, leadId))
      .returning({ id: leads.id });

    if (!updated) return fail<true>('NOT_FOUND', 'La consulta no existe.');
    return ok(true as const);
  });
}
