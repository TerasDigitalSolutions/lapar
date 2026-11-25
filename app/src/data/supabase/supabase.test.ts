import { afterEach, expect, test, vi } from 'vitest';
import { LaparError } from '../types';
import { toLaparError } from './errors';
import { rpcAnon } from './rest';

afterEach(() => vi.unstubAllGlobals());

test('toLaparError maps PostgREST bodies', () => {
  expect(toLaparError({ code: 'P0001', message: 'sold_out', details: 'abc' })).toMatchObject({ code: 'sold_out', detail: 'abc' });
  expect(toLaparError({ code: '23503', message: 'fk' }).code).toBe('in_use');
  expect(toLaparError({ message: 'JWT expired' }).code).toBe('not_signed_in');
  expect(toLaparError({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' })).toMatchObject({ code: 'invalid_input', detail: 'credentials' });
  expect(toLaparError({ status: 401, message: 'x' }).code).toBe('not_signed_in');
  expect(toLaparError(new TypeError('Failed to fetch')).code).toBe('network');
  expect(toLaparError({ message: 'boom' }).code).toBe('unknown');
  expect(toLaparError(new LaparError('forbidden')).code).toBe('forbidden');
});

test('rpcAnon sends apikey and no Authorization, and maps errors', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{"ok":1}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await rpcAnon('get_menu', { p_table_token: 't' })).toEqual({ ok: 1 });
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toMatch(/\/rest\/v1\/rpc\/get_menu$/);
  const headers = init.headers as Record<string, string>;
  expect(Object.keys(headers).map((h) => h.toLowerCase())).toEqual(expect.arrayContaining(['apikey']));
  expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');

  fetchMock.mockResolvedValueOnce(new Response('{"message":"not_found"}', { status: 400 }));
  await expect(rpcAnon('get_menu', {})).rejects.toMatchObject({ code: 'not_found' });
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(rpcAnon('get_menu', {})).rejects.toMatchObject({ code: 'network' });
});
