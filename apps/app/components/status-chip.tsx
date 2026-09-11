import type { VehicleStatus } from '@cuasar/core';
import { STATUS_META } from './vehicle-meta';

export function StatusChip({ status, size = 'md' }: { status: VehicleStatus; size?: 'sm' | 'md' }) {
  const meta = STATUS_META[status];

  return (
    <span
      title={meta.hint}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${meta.chip} ${
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]'
      }`}
    >
      <span className={`size-1.5 rounded-full ${meta.dot}`} aria-hidden />
      {meta.label}
    </span>
  );
}
