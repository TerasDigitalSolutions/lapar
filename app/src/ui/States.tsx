import type { ReactNode } from 'react';
import { isLaparError, type LaparErrorCode } from '../data/types';
import { Button } from './Button';
import { useUiT } from './messages';

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-lg font-bold text-stone-900">{title}</p>
      {children && <div className="max-w-sm text-stone-600">{children}</div>}
      {action}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const t = useUiT();
  return (
    <div role="status" className="flex items-center justify-center gap-3 p-10 text-stone-600">
      <span aria-hidden="true" className="size-6 animate-spin rounded-full border-4 border-stone-300 border-t-orange-600" />
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
      <p className="text-lg font-bold text-stone-900">{t('error_title')}</p>
      <p className="max-w-sm text-stone-700">{t(`err_${code}`)}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
