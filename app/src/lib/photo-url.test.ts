import { expect, test } from 'vitest';
import { resolvePhotoUrl } from './photo-url';

const base = 'https://example.test/lapar/';

test('null and empty', () => {
  expect(resolvePhotoUrl(null, base)).toBeNull();
  expect(resolvePhotoUrl('', base)).toBeNull();
});
test('absolute, data and blob URLs pass through', () => {
  for (const u of ['https://x.test/a.webp', 'http://x.test/a.webp', 'data:image/png;base64,AA', 'blob:https://x.test/1']) {
    expect(resolvePhotoUrl(u, base)).toBe(u);
  }
});
test('relative paths resolve against base', () => {
  expect(resolvePhotoUrl('menu/s/i-abc.webp', base)).toBe('https://example.test/lapar/menu/s/i-abc.webp');
});
test('default base is this site, never the live host', () => {
  expect(resolvePhotoUrl('menu/a.webp')).toBe(`${location.origin}${import.meta.env.BASE_URL}menu/a.webp`);
});
