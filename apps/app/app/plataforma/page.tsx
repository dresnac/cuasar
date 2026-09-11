import {
  getPlatformAdmin,
  getPlatformMetrics,
  listAgencies,
  listAuditLog,
} from '@cuasar/core/services';
import { AgencyAdminTable, PlatformStat } from '@/components/agency-admin';
import { currentLocalUser } from '@/lib/tenant';
import { dateTime, money } from '@/lib/format';

export default async function PlatformPage() {
  const user = await currentLocalUser();
  const admin = (await getPlatformAdmin(user.id))!;

  const [metrics, agencies, audit] = await Promise.all([
    getPlatformMetrics(user.id),
    listAgencies(user.id),
    listAuditLog(user.id, 25),
  ]);

  const paying = metrics.subscriptions.active + metrics.subscriptions.pastDue;

  return (
    <div className="flex flex-col gap-7">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Métricas</h1>
        <p className="mt-0.5 text-[13px] text-paper/55">
          Cuentas y facturación de toda la plataforma. Los datos operativos de cada agencia —stock,
          precios, consultas— no se ven desde acá.
        </p>
      </header>

      <section aria-label="Resumen" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PlatformStat
          label="Ingreso mensual"
          value={money(metrics.mrrCents, 'USD')}
          hint={`${paying} ${paying === 1 ? 'agencia con suscripción' : 'agencias con suscripción'}, ${metrics.subscriptions.trialing} en prueba`}
        />
        <PlatformStat
          label="Agencias activas"
          value={String(metrics.agencies.active)}
          hint={
            metrics.agencies.suspended > 0
              ? `${metrics.agencies.suspended} suspendidas y ${metrics.agencies.cancelled} dadas de baja`
              : `${metrics.agencies.total} en total`
          }
        />
        <PlatformStat
          label="Usuarios"
          value={String(metrics.users)}
          hint={`${metrics.vehicles.total} unidades cargadas, ${metrics.vehicles.published} publicadas`}
        />
        <PlatformStat
          label="Consultas en 30 días"
          value={String(metrics.leadsLast30)}
          hint={
            metrics.failedMessages > 0
              ? `${metrics.failedMessages} avisos quedaron sin poder enviarse`
              : 'La cola de avisos está al día'
          }
        />
      </section>

      {metrics.subscriptions.pastDue > 0 && (
        <p className="rounded-lg border border-[#f0c069]/30 bg-[#f0c069]/10 px-3 py-2 text-[13px] text-[#f0c069]">
          {metrics.subscriptions.pastDue}{' '}
          {metrics.subscriptions.pastDue === 1 ? 'agencia tiene' : 'agencias tienen'} un pago
          pendiente. Pasado el período de gracia quedan en solo lectura.
        </p>
      )}

      <section>
        <h2 className="mb-3 font-display text-[17px] font-semibold tracking-tight">Agencias</h2>
        <AgencyAdminTable agencies={agencies} canAdminister={admin.level === 'ADMIN'} />
      </section>

      <section>
        <h2 className="mb-3 font-display text-[17px] font-semibold tracking-tight">
          Últimas acciones de moderación
        </h2>
        {audit.length === 0 ? (
          <p className="text-[13px] text-paper/50">Todavía no hay nada registrado.</p>
        ) : (
          <ul className="divide-y divide-paper/10 text-[13px]">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
                <span className="tabular text-[12px] text-paper/40">
                  {dateTime(entry.occurredAt)}
                </span>
                <span className="font-medium">{entry.actorName ?? 'Sistema'}</span>
                <span className="text-paper/70">{describe(entry.action)}</span>
                {entry.agencyName && <span className="text-paper/70">{entry.agencyName}</span>}
                {typeof entry.payload.reason === 'string' && (
                  <span className="text-[12px] text-paper/45">“{entry.payload.reason}”</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  'agency.status.suspended': 'suspendió',
  'agency.status.active': 'reactivó',
  'agency.status.cancelled': 'dio de baja',
};
const describe = (action: string) => ACTIONS[action] ?? action;
