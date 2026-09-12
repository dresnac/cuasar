import Link from 'next/link';
import { LEAD_STATUSES, listLeads } from '@cuasar/core/services';
import { can } from '@cuasar/core';
import { LEAD_STATUS_META } from '@/components/lead-meta';
import { LeadCard } from '@/components/lead-row';
import { Card, Empty, cx } from '@/components/ui';
import { agencyTeam, requireSession } from '@/lib/tenant';

export const metadata = { title: 'Consultas' };

export default async function LeadsPage({ searchParams }: PageProps<'/leads'>) {
  const session = await requireSession();
  const params = await searchParams;

  const status = typeof params.estado === 'string' ? [params.estado] : undefined;
  const mine = params.mias === '1';

  const [result, team] = await Promise.all([
    listLeads(session.ctx, {
      status,
      assignedTo: mine ? session.ctx.userId : undefined,
    }),
    agencyTeam(session.agency.agencyId),
  ]);

  if (!result.ok) return <Empty title="Sin acceso">{result.error.message}</Empty>;

  const leads = result.data;
  const canManage = can(session.ctx.role, 'member:manage');
  const sinAtender = leads.filter((l) => l.status === 'NEW').length;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Consultas</h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          {canManage
            ? 'Todas las consultas de la agencia.'
            : 'Las consultas libres y las que estás atendiendo vos.'}
          {sinAtender > 0 && (
            <span className="ml-1 text-signal">
              {sinAtender} {sinAtender === 1 ? 'espera' : 'esperan'} respuesta.
            </span>
          )}
        </p>
      </header>

      <nav aria-label="Filtros" className="flex flex-wrap gap-1.5">
        <Filter href="/leads" active={!params.estado && !mine} label="Todas" />
        {LEAD_STATUSES.map((s) => (
          <Filter
            key={s}
            href={`/leads?estado=${s}`}
            active={params.estado === s}
            label={LEAD_STATUS_META[s].label}
          />
        ))}
        <Filter href="/leads?mias=1" active={mine} label="Mías" />
      </nav>

      {leads.length === 0 ? (
        <Empty title="No hay consultas acá">
          Cuando alguien escriba desde el sitio público, la consulta aparece en esta bandeja con el
          vehículo por el que preguntó.
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {leads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                team={team}
                canManage={canManage}
                currentUserId={session.ctx.userId}
                editable={session.access === 'FULL'}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Filter({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cx(
        'rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
        active
          ? 'border-ink bg-ink text-paper'
          : 'border-line-strong bg-surface text-ink-soft hover:border-ink/40 hover:text-ink',
      )}
    >
      {label}
    </Link>
  );
}
