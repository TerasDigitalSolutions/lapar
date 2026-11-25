const ABSOLUTE = /^(https?:|data:|blob:)/i;

const defaultBase = () => `${location.origin}${import.meta.env.BASE_URL}`;

/** null → null; absolute/data/blob URLs as is; relative paths resolve against `base` (default: this site). */
export function resolvePhotoUrl(url: string | null | undefined, base: string = defaultBase()): string | null {
  if (!url) return null;
  if (ABSOLUTE.test(url)) return url;
  return new URL(url, base).toString();
}
