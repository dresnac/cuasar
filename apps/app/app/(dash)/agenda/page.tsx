import Link from 'next/link';
import { and, asc, eq, inArray, schema, withTenant } from '@cuasar/db';
import { can } from '@cuasar/core';
import { getAvailability, listAppointments } from '@cuasar/core/services';
import { AgendaWeek } from '@/components/agenda-week';
import { AvailabilityForm } from '@/components/availability-form';
import { NewAppointment } from '@/components/new-appointment';
import { Card, Empty, SectionTitle, buttonClass } from '@/components/ui';
import { agencyTeam, requireSession } from '@/lib/tenant';

export const metadata = { title: 'Agenda' };

export default async function AgendaPage({ searchParams }: PageProps<'/agenda'>) {
  const session = await requireSession();
  const params = await searchParams;

  const weekOffset = Number(params.semana ?? 0) || 0;
  const { from, to, days } = weekRange(weekOffset, session.agency.timezone);

  const [result, team, availability, vehicles] = await Promise.all([
    listAppointments(session.ctx, { from, to }),
    agencyTeam(session.agency.agencyId),
    getAvailability(session.ctx),
    listSellableVehicles(session),
  ]);

  if (!result.ok) return <Empty title="Sin acceso">{result.error.message}</Empty>;

  const byDay = new Map<string, typeof result.data>();
  for (const item of result.data) {
    const key = dayKey(item.startsAt, session.agency.timezone);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }

  const columns = days.map((day) => ({ ...day, items: byDay.get(day.key) ?? [] }));
  const total = result.data.length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            {total === 0
              ? 'Esta semana no hay turnos.'
              : `${total} ${total === 1 ? 'turno' : 'turnos'} esta semana.`}{' '}
            {can(session.ctx.role, 'member:manage')
              ? 'Ves los de toda la agencia.'
              : 'Ves los tuyos y los que no tienen dueño.'}
          </p>
        </div>

        <nav aria-label="Semana" className="flex items-center gap-1.5">
          <Link
            href={`/agenda?semana=${weekOffset - 1}`}
            className={buttonClass('secondary', 'sm')}
            aria-label="Semana anterior"
          >
            ←
          </Link>
          {weekOffset !== 0 && (
            <Link href="/agenda" className={buttonClass('secondary', 'sm')}>
              Esta semana
            </Link>
          )}
          <Link
            href={`/agenda?semana=${weekOffset + 1}`}
            className={buttonClass('secondary', 'sm')}
            aria-label="Semana siguiente"
          >
            →
          </Link>
        </nav>
      </header>

      <NewAppointment
        team={team}
        vehicles={vehicles}
        timezone={session.agency.timezone}
        defaultLeadId={typeof params.lead === 'string' ? params.lead : undefined}
        defaultVehicleId={typeof params.vehiculo === 'string' ? params.vehiculo : undefined}
        currentUserId={session.ctx.userId}
        editable={session.access === 'FULL'}
      />

      <AgendaWeek
        days={columns}
        timezone={session.agency.timezone}
        editable={session.access === 'FULL'}
      />

      {can(session.ctx.role, 'agency:settings') && (
        <Card className="max-w-xl p-4">
          <SectionTitle eyebrow="Configuración">Horario de atención</SectionTitle>
          <p className="mb-3 text-[12px] text-ink-soft">
            De acá salen los horarios que se ofrecen al agendar. Un día sin horario es un día sin
            turnos.
          </p>
          <AvailabilityForm current={availability} editable={session.access === 'FULL'} />
        </Card>
      )}
    </div>
  );
}

/** Las unidades que tiene sentido mostrarle a alguien: las que están en el patio. */
async function listSellableVehicles(session: Awaited<ReturnType<typeof requireSession>>) {
  const rows = await withTenant(session.ctx, (tx) =>
    tx
      .select({
        id: schema.vehicles.id,
        brand: schema.vehicles.brand,
        model: schema.vehicles.model,
        year: schema.vehicles.year,
      })
      .from(schema.vehicles)
      .where(
        and(
          eq(schema.vehicles.agencyId, session.ctx.agencyId),
          inArray(schema.vehicles.status, ['PUBLICADO', 'RESERVADO', 'EN_PREPARACION']),
        ),
      )
      .orderBy(asc(schema.vehicles.brand), asc(schema.vehicles.model)),
  );

  return rows.map((v) => ({ id: v.id, label: `${v.brand} ${v.model} ${v.year}` }));
}

const dayKey = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);

/** La semana arranca el lunes: es como se lee una agenda de trabajo. */
function weekRange(offset: number, timeZone: string) {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);

  const todayKey = dayKey(now, timeZone);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const key = dayKey(date, timeZone);

    return {
      key,
      weekday: new Intl.DateTimeFormat('es-AR', { timeZone, weekday: 'short' }).format(date),
      label: new Intl.DateTimeFormat('es-AR', { timeZone, day: 'numeric', month: 'short' }).format(
        date,
      ),
      isToday: key === todayKey,
    };
  });

  const to = new Date(monday);
  to.setDate(monday.getDate() + 7);

  return { from: monday, to, days };
}
