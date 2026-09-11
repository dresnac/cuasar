import Link from 'next/link';
import type { PublicAgency } from '@cuasar/core/services';
import { contactOf } from '@/lib/agency';

export function SiteHeader({ agency }: { agency: PublicAgency }) {
  const contact = contactOf(agency);
  const logo = typeof agency.branding?.logoUrl === 'string' ? agency.branding.logoUrl : null;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-5 py-3.5">
        <Link href="/" className="flex items-center gap-2.5">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-8 w-auto" />
          ) : (
            <span
              className="grid size-8 place-items-center rounded-md font-display text-[13px] font-bold text-white"
              style={{ background: 'var(--brand)' }}
              aria-hidden
            >
              {agency.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span className="font-display text-[17px] font-semibold tracking-tight">
            {agency.name}
          </span>
        </Link>

        {contact.phone && (
          <a
            href={`tel:${contact.phone.replace(/\s/g, '')}`}
            className="rounded-lg px-3 py-2 text-[14px] font-medium transition-colors hover:bg-muted"
            style={{ color: 'var(--brand)' }}
          >
            {contact.phone}
          </a>
        )}
      </div>
    </header>
  );
}

export function SiteFooter({ agency }: { agency: PublicAgency }) {
  const contact = contactOf(agency);

  return (
    <footer className="mt-16 border-t border-line bg-muted">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-5 py-10 sm:flex-row sm:justify-between">
        <div>
          <p className="font-display text-[16px] font-semibold tracking-tight">{agency.name}</p>
          {contact.address && (
            <p className="mt-1 text-[14px] text-ink-soft">
              {contact.address}
              {contact.city && `, ${contact.city}`}
            </p>
          )}
          {contact.hours && <p className="mt-0.5 text-[14px] text-ink-soft">{contact.hours}</p>}
        </div>

        <div className="text-[14px] text-ink-soft">
          {contact.phone && (
            <p>
              <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="hover:text-ink">
                {contact.phone}
              </a>
            </p>
          )}
          <p className="mt-3 text-[12px] text-ink-faint">
            Los precios y la disponibilidad pueden cambiar sin aviso. Consultá antes de venir.
          </p>
        </div>
      </div>
    </footer>
  );
}
