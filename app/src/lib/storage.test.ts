import { afterEach, expect, test, vi } from 'vitest';
import { clearAppKeys } from './storage';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

test('clearAppKeys removes lapar keys from both storages and keeps the rest', () => {
  localStorage.setItem('lapar:ctabs:t1', '1');
  localStorage.setItem('lapar.staff.shop', '1');
  localStorage.setItem('lapar-demo-v1', '1');
  sessionStorage.setItem('lapar:cart:t1', '1');
  sessionStorage.setItem('other', '1');
  clearAppKeys();
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem('lapar-demo-v1')).toBe('1');
  expect(sessionStorage.length).toBe(1);
  expect(sessionStorage.getItem('other')).toBe('1');
});

test('clearAppKeys does not throw when storage throws', () => {
  vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => clearAppKeys()).not.toThrow();
});
