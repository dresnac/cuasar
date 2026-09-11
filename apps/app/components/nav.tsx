'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './ui';

const SECTIONS = [
  { href: '/vehiculos', label: 'Vehículos', ready: true, finance: false },
  { href: '/contabilidad', label: 'Contabilidad', ready: true, finance: true },
  { href: '/agenda', label: 'Agenda', ready: false, finance: false },
  { href: '/leads', label: 'Consultas', ready: false, finance: false },
  { href: '/sitio', label: 'Sitio público', ready: false, finance: false },
] as const;

export function Nav({ showFinance }: { showFinance: boolean }) {
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
            {s.label}
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
