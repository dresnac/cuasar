export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-md">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          No encontramos este sitio
        </h1>
        <p className="mt-2 text-[15px] text-ink-soft">
          El dominio no corresponde a ninguna agencia activa. Si sos el dueño y acabás de
          configurarlo, puede tardar unos minutos en propagarse.
        </p>
      </div>
    </main>
  );
}
