/** Money helpers. Money is integer sen everywhere; format only in the UI. */

/** 1230 -> "RM 12.30" (negative: "-RM 0.05"). */
export function formatRM(sen: number): string {
  const abs = Math.abs(Math.round(sen));
  return `${sen < 0 ? '-' : ''}RM ${String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+$)/g, ',')}.${String(abs % 100).padStart(2, '0')}`;
}

/** "12.3", "RM 12.30" -> sen; null when not a non-negative amount with at most 2 decimals. */
export function parseRM(text: string): number | null {
  const m = /^\s*(?:RM)?\s*(\d+)(?:\.(\d{1,2}))?\s*$/i.exec(text);
  if (!m) return null;
  const sen = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  return Number.isSafeInteger(sen) ? sen : null;
}

/** Same as SQL `round_cash`: nearest 5 sen, remainder 1-2 down, 3-4 up. */
export function roundCash(sen: number): number {
  const r = sen % 5;
  return r < 3 ? sen - r : sen + 5 - r;
}

/** Splits `total` into n shares; the remainder sen go to the first shares. */
export function splitEqual(total: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
