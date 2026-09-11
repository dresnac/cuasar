'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './ui';

const SECTIONS = [
  { href: '/vehiculos', label: 'Vehículos', ready: true },
  { href: '/contabilidad', label: 'Contabilidad', ready: false },
  { href: '/agenda', label: 'Agenda', ready: false },
  { href: '/leads', label: 'Consultas', ready: false },
  { href: '/sitio', label: 'Sitio público', ready: false },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Secciones" className="flex flex-col gap-0.5">
      {SECTIONS.map((s) =>
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
