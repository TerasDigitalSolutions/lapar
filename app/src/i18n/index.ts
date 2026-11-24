import { useSyncExternalStore } from 'react';

export type Locale = 'en' | 'ms' | 'zh';
type Dict = Partial<Record<string, string>>;
export type Messages<K extends string> = { en: Record<K, string> } & Partial<Record<'ms' | 'zh', Partial<Record<K, string>>>>;

let locale: Locale = 'en';
const listeners = new Set<() => void>();

export const getLocale = () => locale;
export function setLocale(l: Locale) {
  locale = l;
  listeners.forEach((f) => f());
}
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));

export function translate(dicts: Partial<Record<Locale, Dict>> & { en: Dict }, key: string, vars?: Record<string, string | number>) {
  const s = dicts[locale]?.[key] ?? dicts.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Each feature calls this with its own messages; returns a typed `useT` hook. */
export function defineMessages<K extends string>(_namespace: string, messages: Messages<K>) {
  return function useT() {
    useSyncExternalStore(subscribe, getLocale);
    return (key: K, vars?: Record<string, string | number>) => translate(messages, key, vars);
  };
}
