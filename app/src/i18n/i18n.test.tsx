import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { defineMessages, setLocale } from './index';

const useT = defineMessages('test', {
  en: { hi: 'Hello {name}', only: 'English only' },
  ms: { hi: 'Helo {name}' },
});

afterEach(() => act(() => setLocale('en')));

test('interpolates in English by default', () => {
  const { result } = renderHook(() => useT());
  expect(result.current('hi', { name: 'Ali' })).toBe('Hello Ali');
});

test('switches locale and falls back to English', () => {
  const { result } = renderHook(() => useT());
  act(() => setLocale('ms'));
  expect(result.current('hi', { name: 'Ali' })).toBe('Helo Ali');
  expect(result.current('only')).toBe('English only');
  act(() => setLocale('zh'));
  expect(result.current('hi', { name: 'Ali' })).toBe('Hello Ali');
});
