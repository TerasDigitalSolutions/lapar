import type { ReactNode } from 'react';

const tone = {
  info: 'border-sky-300 bg-sky-50 text-sky-950',
  warn: 'border-amber-300 bg-amber-50 text-amber-950',
  error: 'border-red-300 bg-red-50 text-red-950',
} as const;

/** Inline notice. Errors are announced immediately (`alert`), others politely (`status`). */
export function Banner({ kind = 'info', children, action }: { kind?: keyof typeof tone; children: ReactNode; action?: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-base ${tone[kind]}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
