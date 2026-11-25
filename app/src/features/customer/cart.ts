import type { MenuItem, Translations, Uuid } from '../../data/types';
import { getLocale } from '../../i18n';
import { readJson, writeJson } from '../../lib/storage';

/** One cart line. Prices are never stored: they are recomputed from the menu for display only. */
export interface CartLine {
  itemId: Uuid;
  qty: number;
  optionIds: Uuid[];
  note: string;
  from: Uuid | null;
}

const key = (kind: string, token: string) => `lapar:${kind}:${token}`;

export const loadCart = (token: string): CartLine[] => readJson<CartLine[]>(key('cart', token), [], 'session');
export const saveCart = (token: string, cart: CartLine[]) => writeJson(key('cart', token), cart, 'session');

/** "Shown once per visit" sets (suggestion sources, nudge) live in sessionStorage per table token. */
export const seenSet = (token: string, kind: string): string[] => readJson<string[]>(key(kind, token), [], 'session');
export const markSeen = (token: string, kind: string, id: string) => {
  const s = seenSet(token, kind);
  if (!s.includes(id)) writeJson(key(kind, token), [...s, id], 'session');
};

export const loadTabId = (token: string): string | null => readJson<string | null>(key('tab', token), null, 'session');
export const saveTabId = (token: string, id: string) => writeJson(key('tab', token), id, 'session');

/** Name in the diner's language when the menu carries a translation (empty unless multi_language_menu). */
export function tr(name: string, translations: Translations): string {
  const l = getLocale();
  return l === 'en' ? name : (translations[l]?.name ?? name);
}

export function unitSen(item: MenuItem, optionIds: readonly Uuid[]): number {
  const delta = new Map(item.groups.flatMap((g) => g.options.map((o) => [o.id, o.priceDeltaSen] as const)));
  return item.effectivePriceSen + optionIds.reduce((s, id) => s + (delta.get(id) ?? 0), 0);
}

export function optionNames(item: MenuItem, optionIds: readonly Uuid[]): string {
  const names = new Map(item.groups.flatMap((g) => g.options.map((o) => [o.id, tr(o.name, o.translations)] as const)));
  return optionIds.map((id) => names.get(id)).filter(Boolean).join(', ');
}

const sameLine = (a: CartLine, b: CartLine) =>
  a.itemId === b.itemId && a.note === b.note && a.from === b.from && [...a.optionIds].sort().join() === [...b.optionIds].sort().join();

/** Adds a line, merging into an identical one (quantity capped at 99). */
export function addLine(cart: CartLine[], line: CartLine): CartLine[] {
  const i = cart.findIndex((l) => sameLine(l, line));
  if (i < 0) return [...cart, line];
  return cart.map((l, j) => (j === i ? { ...l, qty: Math.min(99, l.qty + line.qty) } : l));
}
