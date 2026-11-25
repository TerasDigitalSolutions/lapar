import { expect, test } from 'vitest';
import { backupTargets } from './backup';
import { toCsv } from './csv';

test('toCsv: BOM, CRLF, RFC 4180 quoting, formula guard', () => {
  const out = toCsv(
    [{ a: 'plain', b: 'say "hi", ok', c: 5 }, { a: 'two\nlines', b: '=SUM(A1)', c: null }],
    [{ header: 'A', value: (r) => r.a }, { header: 'B, b', value: (r) => r.b }, { header: 'C', value: (r) => r.c }],
  );
  expect(out.startsWith('﻿')).toBe(true);
  expect(out.slice(1)).toBe('A,"B, b",C\r\nplain,"say ""hi"", ok",5\r\n"two\nlines",\'=SUM(A1),\r\n');
});

test('only the download target is offered', () => {
  expect(backupTargets().map((t) => t.id)).toEqual(['download']);
});
