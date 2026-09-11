'use client';

import { upload } from '@vercel/blob/client';
import Image from 'next/image';
import { useRef, useState, useTransition } from 'react';
import { attachImagesAction, removeImageAction, setCoverAction } from '@/app/(dash)/vehiculos/actions';
import { Alert, Button, cx } from './ui';

export type ExistingImage = {
  id: string;
  blobUrl: string;
  width: number;
  height: number;
  isCover: boolean;
};

const MAX = 40;

export function ImageUploader({
  vehicleId,
  agencySlug,
  images,
  editable,
}: {
  vehicleId: string;
  agencySlug: string;
  images: ExistingImage[];
  editable: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remaining = MAX - images.length;

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);

    const picked = Array.from(files).slice(0, remaining);
    if (picked.length < files.length) {
      setError(`Quedan ${remaining} lugares. Se van a subir las primeras ${picked.length}.`);
    }

    setBusy({ done: 0, total: picked.length });

    try {
      const uploaded = [];
      for (const [i, file] of picked.entries()) {
        const blob = await upload(`${agencySlug}/${vehicleId}/${file.name}`, file, {
          access: 'public',
          handleUploadUrl: '/api/blob/upload',
          clientPayload: vehicleId,
        });

        const { width, height } = await readDimensions(file);
        uploaded.push({
          blobUrl: blob.url,
          blobPathname: blob.pathname,
          width,
          height,
          bytes: file.size,
        });
        setBusy({ done: i + 1, total: picked.length });
      }

      const result = await attachImagesAction(vehicleId, uploaded);
      if (result?.error) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron subir las fotos.');
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="stale">{error}</Alert>}

      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((img) => (
            <li key={img.id} className="group relative aspect-4/3 overflow-hidden rounded-lg bg-paper">
              <Image
                src={img.blobUrl}
                alt=""
                fill
                sizes="(max-width: 640px) 33vw, 180px"
                className="object-cover"
              />

              {img.isCover && (
                <span className="absolute left-1 top-1 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] font-medium text-paper">
                  Portada
                </span>
              )}

              {editable && (
                <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-linear-to-t from-ink/80 to-transparent p-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  {!img.isCover && (
                    <button
                      type="button"
                      onClick={() => startTransition(() => void setCoverAction(vehicleId, img.id))}
                      className="rounded bg-paper/90 px-1.5 py-0.5 text-[10px] font-medium hover:bg-paper"
                    >
                      Portada
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => startTransition(() => void removeImageAction(vehicleId, img.id))}
                    className="ml-auto rounded bg-paper/90 px-1.5 py-0.5 text-[10px] font-medium text-stale hover:bg-paper"
                  >
                    Quitar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className={cx('flex items-center gap-3', (busy || pending) && 'opacity-60')}>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            className="hidden"
            onChange={(e) => void onFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={Boolean(busy) || remaining <= 0}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? `Subiendo ${busy.done} de ${busy.total}…` : 'Agregar fotos'}
          </Button>
          <span className="text-[12px] text-ink-faint">
            {remaining > 0 ? `${remaining} lugares disponibles` : 'Llegaste al máximo de 40'}
          </span>
        </div>
      )}
    </div>
  );
}

/** Las dimensiones reales importan: sin ellas next/image no puede reservar espacio. */
function readDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 1200, height: 900 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
