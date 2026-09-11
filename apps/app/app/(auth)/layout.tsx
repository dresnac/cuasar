export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        <div className="text-center">
          <p className="font-display text-[26px] font-semibold tracking-tight">Cuasar</p>
          <p className="mt-1 text-[13px] text-ink-soft">
            El patio, la contabilidad y el sitio, en un solo lugar.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
