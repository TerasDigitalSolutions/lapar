import type { ReactNode } from 'react';
import { isLaparError, type LaparErrorCode } from '../data/types';
import { Button } from './Button';
import { useUiT } from './messages';

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-orange-100 text-orange-700">
        <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 11h16M5 11a7 7 0 0 0 14 0M9 4c0 1.5-1 1.5-1 3M13 4c0 1.5-1 1.5-1 3M17 4c0 1.5-1 1.5-1 3" />
        </svg>
      </span>
      <p className="text-xl font-extrabold text-stone-900">{title}</p>
      {children && <div className="max-w-sm text-stone-600">{children}</div>}
      {action}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const t = useUiT();
  return (
    <div role="status" className="flex items-center justify-center gap-3 p-10 font-medium text-stone-700">
      <span aria-hidden="true" className="size-7 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" />
      <span>{label ?? t('loading')}</span>
    </div>
  );
}

/** Friendly message for any thrown value; `LaparError` codes map to specific text. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useUiT();
  const code: LaparErrorCode = isLaparError(error) ? error.code : 'unknown';
  return (
    <div role="alert" className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-red-100 text-3xl font-black text-red-700">
        !
      </span>
      <p className="text-xl font-extrabold text-stone-900">{t('error_title')}</p>
      <p className="max-w-sm text-stone-700">{t(`err_${code}`)}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
