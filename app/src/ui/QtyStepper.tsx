import { focusRing } from './Button';
import { useUiT } from './messages';

const btn = `inline-flex size-12 items-center justify-center rounded-2xl border border-stone-300 bg-white text-2xl shadow-sm font-semibold text-stone-900 active:bg-stone-100 disabled:opacity-40 ${focusRing}`;

/** − n + stepper. `min` defaults to 0 so a line can reach zero; pass 1 to stop there. */
export function QtyStepper({ value, onChange, min = 0, max = 99, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label?: string }) {
  const t = useUiT();
  return (
    <div role="group" aria-label={label ?? t('quantity')} className="inline-flex items-center gap-2">
      <button type="button" className={btn} aria-label={t('decrease')} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <span aria-hidden="true">−</span>
      </button>
      <output aria-live="polite" className="min-w-8 text-center text-lg font-bold tabular-nums">
        {value}
      </output>
      <button type="button" className={btn} aria-label={t('increase')} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
