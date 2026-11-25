/** Web Storage wrappers. Every access is in try/catch: storage can throw (private mode, blocked). */
export type StorageArea = 'local' | 'session';

function area(kind: StorageArea): Storage | null {
  try {
    return kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, fallback: T, kind: StorageArea = 'local'): T {
  try {
    const raw = area(kind)?.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Returns false when the write failed (quota, blocked). */
export function writeJson(key: string, value: unknown, kind: StorageArea = 'local'): boolean {
  try {
    const storage = area(kind);
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string, kind: StorageArea = 'local'): void {
  try {
    area(kind)?.removeItem(key);
  } catch {
    /* ignore */
  }
}
