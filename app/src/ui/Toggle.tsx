import { focusRing } from './Button';

/** Switch with a visible label on the left. Whole row is the touch target. */
export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex min-h-12 w-full items-center justify-between gap-4 rounded-xl px-1 py-2 text-left disabled:opacity-50 ${focusRing}`}
    >
      <span className="flex flex-col">
        <span className="text-base font-semibold text-stone-900">{label}</span>
        {description && <span className="text-sm text-stone-600">{description}</span>}
      </span>
      <span aria-hidden="true" className={`flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors ${checked ? 'bg-orange-600' : 'bg-stone-300'}`}>
        <span className={`size-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : ''}`} />
      </span>
    </button>
  );
}
