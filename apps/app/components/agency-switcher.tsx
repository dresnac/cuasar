'use client';

import { useState, useTransition } from 'react';
import type { Membership } from '@/lib/tenant';
import { selectAgency } from '@/app/(dash)/actions';

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Dueño',
  ADMIN: 'Administrador',
  SALES: 'Ventas',
  VIEWER: 'Solo lectura',
};

export function AgencySwitcher({
  active,
  memberships,
}: {
  active: Membership;
  memberships: Membership[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const single = memberships.length === 1;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !single && setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup={single ? undefined : 'listbox'}
        disabled={single || pending}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors enabled:hover:bg-paper"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-ink font-display text-[13px] font-bold text-paper">
          {active.agencyName.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[14px] font-semibold leading-tight tracking-tight">
            {active.agencyName}
          </span>
          <span className="block text-[11px] leading-tight text-ink-faint">
            {ROLE_LABEL[active.role] ?? active.role}
          </span>
        </span>
        {!single && (
          <span aria-hidden className="text-ink-faint">
            ⌄
          </span>
        )}
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-lg shadow-ink/5"
        >
          {memberships.map((m) => (
            <li key={m.agencyId}>
              <button
                type="button"
                role="option"
                aria-selected={m.agencyId === active.agencyId}
                onClick={() =>
                  startTransition(async () => {
                    await selectAgency(m.agencyId);
                    setOpen(false);
                  })
                }
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] hover:bg-paper"
              >
                <span className="truncate">{m.agencyName}</span>
                {m.agencyId === active.agencyId && <span className="text-signal">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
