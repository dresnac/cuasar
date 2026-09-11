'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { CatalogImage } from '@cuasar/core/services';

export function Gallery({ images, alt }: { images: CatalogImage[]; alt: string }) {
  const [active, setActive] = useState(0);
  const current = images[active];

  if (!current) {
    return (
      <div className="grid aspect-4/3 place-items-center rounded-xl bg-muted text-[14px] text-ink-faint">
        Sin fotos
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-4/3 overflow-hidden rounded-xl bg-muted">
        <Image
          key={current.url}
          src={current.url}
          alt={alt}
          fill
          sizes="(max-width: 1024px) 100vw, 720px"
          priority
          placeholder={current.blur ? 'blur' : 'empty'}
          blurDataURL={current.blur ?? undefined}
          className="object-cover"
        />
      </div>

      {images.length > 1 && (
        <ul className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {images.map((image, i) => (
            <li key={image.url}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Foto ${i + 1} de ${images.length}`}
                aria-current={i === active}
                className="relative block aspect-4/3 w-full overflow-hidden rounded-md bg-muted"
                style={{ outline: i === active ? '2px solid var(--brand)' : undefined, outlineOffset: 1 }}
              >
                <Image
                  src={image.url}
                  alt=""
                  fill
                  sizes="90px"
                  className={`object-cover transition-opacity ${i === active ? '' : 'opacity-70 hover:opacity-100'}`}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
