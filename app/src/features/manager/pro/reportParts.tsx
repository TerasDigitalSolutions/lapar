/** Strings and small pieces shared by the reports, upsell and export sections. */
import { useState } from 'react';
import type { IsoDate } from '../../../data/types';
import { useLimit } from '../../../entitlements/hooks';
import { addDays, mytToday } from '../../../lib/time';
import { defineMessages } from '../../../i18n';
import { Field, inputClass } from '../../../ui';

const en = {
  reports_title: 'Reports',
  from: 'From',
  to: 'To',
  range_bad: 'Pick a start day on or before the end day, at most {max} days apart, no earlier than {min}.',
  sales: 'Sales',
  orders: 'Orders',
  bills: 'Bills',
  average_bill: 'Average bill',
  by_day: 'Sales by day',
  by_hour: 'Sales by hour',
  best: 'Best sellers',
  worst: 'Slowest sellers',
  prep: 'Prep time',
  prep_overall: 'All dishes: average {avg} min, median {median} min ({count} lines)',
  prep_row: '{avg} min avg · {median} min median · {count}',
  no_data: 'No sales in this range',
  sold_qty: '{n} sold',
  upsell_title: 'Upsell',
  month: 'Month',
  upsell_earned: 'Earned from suggestions',
  upsell_adds: 'Suggestions added',
  upsell_row: '{source} suggests {suggested}',
  upsell_detail: '{adds} added from {orders} orders · {rate}% take-up · {amount}',
  upsell_none: 'No suggestions were added this month',
  export_title: 'Export and backup',
  export_hint: 'Files are saved to this device. Keep them somewhere safe.',
  save_to: 'Save to',
  export_orders: 'Orders CSV',
  export_payments: 'Payments CSV',
  export_sales: 'Sales by day CSV',
  export_json: 'Full backup (JSON)',
  export_done: 'Saved {name}',
} as const;

export type ReportKey = keyof typeof en;
export const useReportT = defineMessages<ReportKey>('manager-reports', { en });

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_SPAN = 366;

export const spanOf = (from: IsoDate, to: IsoDate): number => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** Date range inputs defaulting to the last 30 days (today included), clamped to the plan's report window. */
export function useDateRange(maxSpan: number = MAX_SPAN) {
  const t = useReportT();
  const limit = useLimit('report_history_days');
  const today = mytToday();
  const min = limit === null ? undefined : addDays(today, -(limit - 1));
  const [typed, setTyped] = useState({ from: addDays(today, -29), to: today });
  const { from, to } = typed;
  const valid = DAY.test(from) && DAY.test(to) && from <= to && to <= today && spanOf(from, to) <= maxSpan && (!min || from >= min);
  const fields = (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('from')} error={valid ? null : t('range_bad', { max: maxSpan, min: min ?? '-' })}>
        {(p) => <input {...p} type="date" className={inputClass} value={from} min={min} max={to || today} onChange={(e) => setTyped({ ...typed, from: e.target.value })} />}
      </Field>
      <Field label={t('to')}>
        {(p) => <input {...p} type="date" className={inputClass} value={to} min={from || min} max={today} onChange={(e) => setTyped({ ...typed, to: e.target.value })} />}
      </Field>
    </div>
  );
  return { from, to, valid, fields };
}

/** Horizontal CSS bars: one row per entry, readable on a phone. */
export function Bars({ rows, label }: { rows: { key: string; label: string; value: number; text: string }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[4.5rem_1fr_5.5rem] items-center gap-2 text-sm">
          <span className="text-stone-700 tabular-nums">{r.label}</span>
          <span className="h-4 rounded bg-stone-100" aria-hidden="true">
            <span className="block h-4 rounded bg-orange-500" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-semibold text-stone-900 tabular-nums">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
