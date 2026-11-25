import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatRM, parseRM, roundCash, splitEqual } from './money';
import { addDays, inWindow, minutesSince, mytDayOf, mytParts, mytToday } from './time';
import { canMove, customerStatus } from './status';
import { mulberry32 } from './rng';
import { readJson, removeKey, writeJson } from './storage';
import type { ItemStatus } from '../data/types';

describe('money', () => {
  it('formats and parses', () => {
    expect(formatRM(1230)).toBe('RM 12.30');
    expect(formatRM(5)).toBe('RM 0.05');
  expect(formatRM(737350)).toBe('RM 7,373.50');
  expect(formatRM(100000000)).toBe('RM 1,000,000.00');
    expect(formatRM(-5)).toBe('-RM 0.05');
    expect(parseRM('12.3')).toBe(1230);
    expect(parseRM('RM 12.30')).toBe(1230);
    expect(parseRM('7')).toBe(700);
    expect(parseRM('12.345')).toBeNull();
    expect(parseRM('-1')).toBeNull();
    expect(parseRM('abc')).toBeNull();
    expect(parseRM('')).toBeNull();
  });
  it('rounds cash to 5 sen (SQL round_cash)', () => {
    const expected = [1230, 1230, 1235, 1235, 1235, 1235, 1235, 1240, 1240];
    [1231, 1232, 1233, 1234, 1235, 1236, 1237, 1238, 1239].forEach((sen, i) => expect(roundCash(sen)).toBe(expected[i]));
    expect(roundCash(1240)).toBe(1240);
  });
  it('splits equally with the remainder first', () => {
    expect(splitEqual(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEqual(1000, 1)).toEqual([1000]);
    expect(() => splitEqual(100, 0)).toThrow();
  });
});

describe('time', () => {
  it('uses the MYT calendar', () => {
    expect(mytToday(new Date('2026-11-25T16:30:00Z'))).toBe('2026-11-26');
    expect(mytDayOf('2026-11-25T15:59:00Z')).toBe('2026-11-25');
    const p = mytParts(new Date('2026-11-25T00:00:00Z')); // Wednesday 08:00 MYT
    expect([p.hour, p.minute, p.weekday]).toEqual([8, 0, 3]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('in_window handles plain, wrapped and weekday windows', () => {
    const plain = { from: '14:00', to: '17:00', days: null };
    expect(inWindow(plain, '2026-11-25T06:00:00Z')).toBe(true); // 14:00 MYT
    expect(inWindow(plain, '2026-11-25T09:00:00Z')).toBe(false); // 17:00 MYT: end exclusive
    const wrap = { from: '22:00', to: '02:00', days: null };
    expect(inWindow(wrap, '2026-11-25T15:00:00Z')).toBe(true); // 23:00 MYT
    expect(inWindow(wrap, '2026-11-25T17:00:00Z')).toBe(true); // 01:00 MYT
    expect(inWindow(wrap, '2026-11-25T04:00:00Z')).toBe(false); // 12:00 MYT
    const mondays = { from: '06:00', to: '23:00', days: [1] as 1[] };
    expect(inWindow(mondays, '2026-11-25T04:00:00Z')).toBe(false); // a Wednesday
    expect(inWindow(mondays, '2026-11-23T04:00:00Z')).toBe(true); // a Monday
  });
  it('minutesSince never goes negative', () => {
    const now = new Date('2026-11-25T10:00:00Z');
    expect(minutesSince('2026-11-25T09:49:30Z', now)).toBe(10);
    expect(minutesSince('2026-11-25T10:05:00Z', now)).toBe(0);
  });
});

describe('status', () => {
  const all: ItemStatus[] = ['pending', 'new', 'preparing', 'cooking', 'ready', 'served', 'cancelled'];
  const allowed = new Set([
    'new>preparing', 'preparing>cooking', 'cooking>ready', 'ready>served',
    'preparing>new', 'cooking>preparing', 'ready>cooking',
    'new>cancelled', 'preparing>cancelled', 'cooking>cancelled', 'ready>cancelled',
  ]);
  it('matches the advance_item table for every pair', () => {
    for (const from of all)
      for (const to of all) {
        expect(canMove(from, to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`));
        expect(canMove(from, to, true), `${from}>${to} col`).toBe(from === to || allowed.has(`${from}>${to}`));
      }
  });
  it('maps customer labels', () => {
    expect(all.map(customerStatus)).toEqual(['waiting', 'received', 'cooking', 'cooking', 'ready', 'served', 'cancelled']);
  });
});

describe('rng', () => {
  it('is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seq = [a(), a(), a()];
    expect(seq).toEqual([b(), b(), b()]);
    expect(seq.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    removeKey('k');
  });
  it('round trips and falls back', () => {
    expect(readJson('k', 5)).toBe(5);
    expect(writeJson('k', { a: 1 })).toBe(true);
    expect(readJson('k', null)).toEqual({ a: 1 });
    localStorage.setItem('k', '{bad');
    expect(readJson('k', 'fb')).toBe('fb');
  });
  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readJson('k', 'fb')).toBe('fb');
    expect(writeJson('k', 1)).toBe(false);
    expect(() => removeKey('k')).not.toThrow();
  });
});
