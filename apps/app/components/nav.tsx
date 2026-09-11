'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './ui';

const SECTIONS = [
  { href: '/vehiculos', label: 'Vehículos', ready: true, finance: false },
  { href: '/contabilidad', label: 'Contabilidad', ready: true, finance: true },
  { href: '/agenda', label: 'Agenda', ready: true, finance: false },
  { href: '/leads', label: 'Consultas', ready: true, finance: false },
  { href: '/sitio', label: 'Sitio público', ready: false, finance: false },
] as const;

export function Nav({ showFinance, newLeads }: { showFinance: boolean; newLeads: number }) {
  const pathname = usePathname();

  // Una sección que el rol no puede abrir no se muestra apagada: se saca.
  // Un link que siempre rebota enseña a desconfiar de la navegación.
  const sections = SECTIONS.filter((s) => !s.finance || showFinance);

  return (
    <nav aria-label="Secciones" className="flex flex-col gap-0.5">
      {sections.map((s) =>
        s.ready ? (
          <Link
            key={s.href}
            href={s.href}
            aria-current={pathname.startsWith(s.href) ? 'page' : undefined}
            className={cx(
              'rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
              pathname.startsWith(s.href)
                ? 'bg-ink text-paper'
                : 'text-ink-soft hover:bg-paper hover:text-ink',
            )}
          >
            <span className="flex items-center justify-between gap-2">
              {s.label}
              {s.href === '/leads' && newLeads > 0 && (
                <span
                  className={cx(
                    'tabular rounded-full px-1.5 text-[11px] font-semibold leading-[18px]',
                    pathname.startsWith(s.href) ? 'bg-paper text-ink' : 'bg-signal text-white',
                  )}
                  aria-label={`${newLeads} sin atender`}
                >
                  {newLeads}
                </span>
              )}
            </span>
          </Link>
        ) : (
          <span
            key={s.href}
            title="Todavía no está construido"
            className="cursor-default rounded-lg px-2.5 py-2 text-[13px] font-medium text-ink-faint/70"
          >
            {s.label}
          </span>
        ),
      )}
    </nav>
  );
}
