import type {
  CategoryRow,
  ItemRow,
  ModifierGroupRow,
  ModifierOptionRow,
  ShopSettings,
  StaffRow,
  TableRow,
  TimeWindow,
} from '../types';

type Raw = Record<string, unknown>;

/** snake_case table row -> camelCase object (shallow). */
export function camelRow<T>(row: Raw): T {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]),
  ) as T;
}

/** camelCase row minus the columns the DTO does not carry. */
const mapRow = <T>(row: Raw, drop: string[]): T => {
  const r = camelRow<Raw>(row);
  for (const k of drop) delete r[k];
  return r as T;
};

const hhmm = (t: unknown) => String(t).slice(0, 5); // Postgres time 'HH:MM:SS'

/** categories.available_from/to/days -> TimeWindow (null without a window). */
export function windowOf(row: Raw): TimeWindow | null {
  if (row.available_from == null || row.available_to == null) return null;
  return { from: hhmm(row.available_from), to: hhmm(row.available_to), days: (row.available_days as TimeWindow['days']) ?? null };
}

/** TimeWindow -> category columns. */
export const windowColumns = (w: TimeWindow | null) => ({
  available_from: w?.from ?? null,
  available_to: w?.to ?? null,
  available_days: w?.days ?? null,
});

export const categoryRow = (row: Raw): CategoryRow => ({
  ...mapRow<CategoryRow>(row, ['availableFrom', 'availableTo', 'availableDays', 'createdAt']),
  window: windowOf(row),
});
export const itemRow = (row: Raw) => mapRow<ItemRow>(row, ['createdAt', 'updatedAt']);
export const groupRow = (row: Raw) => mapRow<ModifierGroupRow>(row, ['createdAt']);
export const optionRow = (row: Raw) => mapRow<ModifierOptionRow>(row, ['createdAt']);
export const tableRow = (row: Raw) => mapRow<TableRow>(row, ['createdAt']);
export const staffRow = (row: Raw) => camelRow<StaffRow>(row);
export const shopSettings = (row: Raw) => camelRow<ShopSettings>(row);
