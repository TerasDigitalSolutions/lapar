import { expect, test } from 'vitest';
import { SITE_BASE_URL } from '../config';
import { qrSvg, tableQrUrl } from './qr';

test('table QR url is the site base plus #/t/token', () => {
  expect(tableQrUrl('abc123')).toBe(`${SITE_BASE_URL}#/t/abc123`);
  expect(tableQrUrl('abc123')).toMatch(/#\/t\/abc123$/);
});

test('qrSvg returns a self-contained svg that differs per text', () => {
  const a = qrSvg(tableQrUrl('one'));
  expect(a.startsWith('<svg')).toBe(true);
  expect(a).toContain('<path');
  expect(qrSvg(tableQrUrl('two'))).not.toBe(a);
});
