/** RFC 4180 CSV with a UTF-8 BOM so Excel opens it correctly. */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

export const CSV_BOM = '﻿';

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Stop spreadsheets running text that starts like a formula (numbers are left alone).
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Header row plus one line per row, CRLF separated, BOM first. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(','), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(','))];
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}
