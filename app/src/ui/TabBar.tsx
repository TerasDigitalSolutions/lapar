import type { ReactNode } from 'react';
import { focusRing } from './Button';

export interface TabItem<Id extends string> {
  id: Id;
  label: string;
  /** Small count or dot shown beside the label (e.g. pending orders). */
  badge?: ReactNode;
}

/** Tab strip. Give each panel `role="tabpanel"` and `id={`panel-${id}`}`; tabs have `id={`tab-${id}`}`. */
export function TabBar<Id extends string>({ tabs, value, onChange, label }: { tabs: readonly TabItem<Id>[]; value: Id; onChange: (id: Id) => void; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex border-b border-stone-200 bg-white">
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => {
              const i = tabs.findIndex((x) => x.id === value);
              const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
              if (next === null) return;
              e.preventDefault();
              const target = tabs[(next + tabs.length) % tabs.length]!;
              onChange(target.id);
              document.getElementById(`tab-${target.id}`)?.focus();
            }}
            className={`relative flex min-h-12 flex-1 items-center justify-center gap-2 px-3 text-base font-semibold ${focusRing} ${
              selected ? 'border-b-4 border-orange-600 text-orange-700' : 'border-b-4 border-transparent text-stone-600 hover:text-stone-900'
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge !== null && tab.badge !== false && (
              <span className="min-w-6 rounded-full bg-orange-600 px-2 text-center text-sm font-bold text-white">{tab.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
