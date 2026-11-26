import { useId, type ReactNode } from 'react';

/** Class for text inputs, textareas and selects inside a Field. */
export const inputClass =
  'block min-h-12 w-full rounded-xl border border-stone-400 bg-white px-4 py-3 text-base text-stone-900 placeholder:text-stone-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-orange-600 aria-[invalid=true]:border-red-600 disabled:bg-stone-100';

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

/**
 * Label + control + hint + error. The control comes from the render prop so any input fits:
 * `<Field label="Name">{(p) => <input {...p} className={inputClass} />}</Field>`
 */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (props: FieldControlProps) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-base font-semibold text-stone-800">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p id={hintId} className="text-sm text-stone-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
