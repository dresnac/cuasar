import type { ComponentProps, ReactNode } from 'react';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink/90 border-ink',
  secondary: 'bg-surface text-ink border-line-strong hover:border-ink/40 hover:bg-paper',
  ghost: 'bg-transparent text-ink-soft border-transparent hover:bg-paper hover:text-ink',
  danger: 'bg-surface text-stale border-stale/30 hover:bg-stale-soft',
};

/** Las mismas clases para <button> y para un <Link> que actúa como botón. */
export const buttonClass = (variant: Variant = 'primary', size: 'sm' | 'md' = 'md', extra?: string) =>
  cx(
    'inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
    size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
    VARIANTS[variant],
    extra,
  );

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 flex items-baseline gap-1.5 text-[13px] font-medium text-ink">
        {label}
        {required && <span className="text-stale">*</span>}
        {hint && <span className="text-[12px] font-normal text-ink-faint">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-[12px] text-stale">{error}</span>}
    </label>
  );
}

const controlBase =
  'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-signal focus:outline-none';

export const Input = ({ className, ...props }: ComponentProps<'input'>) => (
  <input className={cx(controlBase, 'h-10', className)} {...props} />
);

export const Textarea = ({ className, ...props }: ComponentProps<'textarea'>) => (
  <textarea className={cx(controlBase, 'py-2.5', className)} rows={4} {...props} />
);

export const Select = ({ className, ...props }: ComponentProps<'select'>) => (
  <select className={cx(controlBase, 'h-10 pr-8', className)} {...props} />
);

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cx('rounded-card border border-line bg-surface', className)}
      {...props}
    />
  );
}

/** Título de sección. El eyebrow nombra la sección; el h no la repite. */
export function SectionTitle({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      {eyebrow && (
        <p className="mb-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">
          {eyebrow}
        </p>
      )}
      <h2 className="font-display text-[17px] font-semibold tracking-tight">{children}</h2>
    </div>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center">
      <p className="font-display text-[17px] font-semibold tracking-tight">{title}</p>
      {children && <p className="max-w-sm text-sm text-ink-soft">{children}</p>}
      {action}
    </div>
  );
}

export function Alert({ tone = 'warm', children }: { tone?: 'warm' | 'stale'; children: ReactNode }) {
  return (
    <p
      role="status"
      className={cx(
        'rounded-lg border px-3 py-2 text-[13px]',
        tone === 'stale'
          ? 'border-stale/25 bg-stale-soft text-stale'
          : 'border-warm/30 bg-warm-soft text-warm',
      )}
    >
      {children}
    </p>
  );
}

export { cx };
