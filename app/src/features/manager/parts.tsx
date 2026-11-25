import type { ReactNode } from 'react';
import { IconButton } from '../../ui';
import { useManagerT } from './messages';

/** Up and down buttons (nothing is dragged). */
export function UpDown({ index, count, name, onMove }: { index: number; count: number; name: string; onMove: (delta: -1 | 1) => void }) {
  const t = useManagerT();
  return (
    <>
      <IconButton label={t('move_up', { name })} disabled={index === 0} onClick={() => onMove(-1)}>
        ↑
      </IconButton>
      <IconButton label={t('move_down', { name })} disabled={index === count - 1} onClick={() => onMove(1)}>
        ↓
      </IconButton>
    </>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}

export function Heading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3">
      <h2 className="text-xl font-bold text-stone-900">{children}</h2>
      {aside}
    </div>
  );
}

export const Tag = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center rounded-full bg-stone-200 px-2.5 py-0.5 text-sm font-semibold text-stone-800">{children}</span>
);
