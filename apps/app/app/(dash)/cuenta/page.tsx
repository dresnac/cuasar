import { can } from '@cuasar/core';
import { getBillingSummary, getSeatState, listMembers } from '@cuasar/core/services';
import { availableProviders } from '@cuasar/integrations';
import { BillingPanel } from '@/components/billing-panel';
import { TeamPanel } from '@/components/team-panel';
import { Card, Empty, SectionTitle } from '@/components/ui';
import { requireSession } from '@/lib/tenant';

export const metadata = { title: 'Cuenta' };

export default async function AccountPage() {
  const session = await requireSession();

  if (!can(session.ctx.role, 'member:manage')) {
    return (
      <Empty title="Sección restringida">
        La cuenta y el equipo los administra un dueño o un administrador de la agencia.
      </Empty>
    );
  }

  const [members, seats, billing] = await Promise.all([
    listMembers(session.ctx),
    getSeatState(session.ctx),
    getBillingSummary(session.ctx),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Cuenta</h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          {session.agency.agencyName} · {session.agency.agencySlug}.cuasar.app
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle eyebrow="Suscripción">Plan y facturación</SectionTitle>
          {billing.ok ? (
            <BillingPanel summary={billing.data} providers={availableProviders()} />
          ) : (
            <p className="text-[13px] text-ink-soft">{billing.error.message}</p>
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle eyebrow={`${seats.used} de ${seats.limit}`}>Equipo</SectionTitle>
          <TeamPanel members={members} seats={seats} editable={session.access === 'FULL'} />
        </Card>
      </div>
    </div>
  );
}
