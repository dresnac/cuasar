import { UserButton } from '@clerk/nextjs';
import { canSeeFinancials } from '@cuasar/core';
import { countNewLeads } from '@cuasar/core/services';
import { AgencySwitcher } from '@/components/agency-switcher';
import { Nav } from '@/components/nav';
import { requireSession } from '@/lib/tenant';

export default async function DashboardLayout({ children }: LayoutProps<'/'>) {
  const session = await requireSession();
  const newLeads = await countNewLeads(session.ctx);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between border-r border-line bg-surface px-3 py-4 lg:flex">
        <div className="flex flex-col gap-5">
          <AgencySwitcher active={session.agency} memberships={session.memberships} />
          <Nav showFinance={canSeeFinancials(session.ctx.role)} newLeads={newLeads} />
        </div>

        <div className="flex items-center gap-2.5 border-t border-line px-2 pt-3">
          <UserButton
            appearance={{ elements: { avatarBox: 'size-7' } }}
            userProfileProps={{ appearance: { elements: { profileSection__danger: 'hidden' } } }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight">
              {session.user.name ?? 'Sin nombre'}
            </span>
            <span className="block truncate text-[11px] leading-tight text-ink-faint">
              {session.user.email}
            </span>
          </span>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
          <AgencySwitcher active={session.agency} memberships={session.memberships} />
          <UserButton />
        </header>

        {session.access === 'READ_ONLY' && (
          <p className="border-b border-warm/25 bg-warm-soft px-4 py-2 text-[13px] text-warm lg:px-8">
            La suscripción tiene un pago pendiente. Podés consultar el stock, pero no modificarlo.
          </p>
        )}

        <main className="mx-auto max-w-[1180px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
