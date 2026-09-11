/**
 * Lo que se ve mientras el servidor resuelve de qué agencia es este dominio.
 *
 * Tiene la forma del contenido real —barra, grilla, tarjetas— para que la
 * página no salte cuando llega. Un spinner centrado haría lo contrario.
 */
export function CatalogSkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
      <div className="border-b border-line">
        <div className="mx-auto flex max-w-[1200px] items-center gap-2.5 px-5 py-3.5">
          <div className="size-8 rounded-md bg-muted" />
          <div className="h-4 w-40 rounded bg-muted" />
        </div>
      </div>

      <div className="mx-auto max-w-[1200px] px-5 py-8">
        <div className="h-8 w-64 rounded bg-muted" />
        <div className="mt-2 h-4 w-80 rounded bg-muted" />
        <div className="mt-6 h-10 w-full max-w-md rounded-lg bg-muted" />

        <ul className="mt-8 grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <div className="aspect-4/3 rounded-xl bg-muted" />
              <div className="mt-3 h-4 w-2/3 rounded bg-muted" />
              <div className="mt-2 h-3 w-1/2 rounded bg-muted" />
              <div className="mt-3 h-5 w-1/3 rounded bg-muted" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function VehicleSkeleton() {
  return (
    <div aria-hidden className="mx-auto max-w-[1200px] animate-pulse px-5 py-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="aspect-4/3 rounded-xl bg-muted" />
          <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-6">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="aspect-4/3 rounded-md bg-muted" />
            ))}
          </div>
        </div>
        <div>
          <div className="h-32 rounded-xl bg-muted" />
          <div className="mt-4 h-72 rounded-xl bg-muted" />
        </div>
      </div>
    </div>
  );
}
