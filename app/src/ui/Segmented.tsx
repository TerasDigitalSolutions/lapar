import { focusRing } from './Button';

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
}

/** Choose one of a few options (radio group look). */
export function Segmented<V extends string>({ options, value, onChange, label }: { options: readonly SegmentOption<V>[]; value: V; onChange: (v: V) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-2xl bg-stone-200 p-1">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`min-h-12 flex-1 rounded-xl px-3 text-base font-semibold ${focusRing} ${selected ? 'bg-white text-orange-700 shadow-md' : 'text-stone-600 hover:text-stone-900'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
