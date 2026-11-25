/** Asia/Kuala_Lumpur (MYT) time helpers. "Today" is always the MYT date. */
import type { IsoDate, IsoWeekday, TimeWindow } from '../data/types';

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kuala_Lumpur',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});
const WEEKDAYS: Record<string, IsoWeekday> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface MytParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: IsoWeekday;
  /** 'YYYY-MM-DD' */
  date: IsoDate;
}

export function mytParts(date: Date): MytParts {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAYS[p.weekday ?? ''] ?? 1,
    date: `${p.year}-${p.month}-${p.day}`,
  };
}

export const mytToday = (now: Date = new Date()): IsoDate => mytParts(now).date;
export const mytDayOf = (iso: string): IsoDate => mytParts(new Date(iso)).date;

/** Same rule as SQL `in_window`: weekday filter, and a window with to <= from wraps past midnight. */
export function inWindow(window: TimeWindow, at: Date | string): boolean {
  const p = mytParts(typeof at === 'string' ? new Date(at) : at);
  if (window.days && !window.days.includes(p.weekday)) return false;
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const t = p.hour * 60 + p.minute;
  const from = toMin(window.from);
  const to = toMin(window.to);
  return from < to ? t >= from && t < to : t >= from || t < to;
}

/** Whole minutes from `iso` to `now`, never negative. */
export const minutesSince = (iso: string, now: Date = new Date()): number =>
  Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));

/** Calendar arithmetic on 'YYYY-MM-DD'. */
export function addDays(day: IsoDate, n: number): IsoDate {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
