import { expect, test } from 'vitest';
import { ENTITLEMENT_TEXT } from './messages';
import {
  BASIC_FEATURES,
  FEATURE_KEYS,
  LIMIT_KEYS,
  PLAN_DEFAULTS,
  PRO_ONLY_FEATURES,
  isFeatureKey,
  isLimitKey,
  resolveEntitlements,
  withinLimit,
} from './keys';

test('key lists', () => {
  expect(BASIC_FEATURES).toHaveLength(12);
  expect(PRO_ONLY_FEATURES).toHaveLength(13);
  expect(new Set(FEATURE_KEYS).size).toBe(25);
  expect([...LIMIT_KEYS]).toEqual(['max_tables', 'max_stations', 'max_staff', 'report_history_days']);
  expect(isFeatureKey('combos')).toBe(true);
  expect(isFeatureKey('max_tables')).toBe(false);
  expect(isLimitKey('max_tables')).toBe(true);
});

test('every key has a label and description', () => {
  for (const k of [...FEATURE_KEYS, ...LIMIT_KEYS]) {
    expect(ENTITLEMENT_TEXT[k].label).not.toBe('');
    expect(ENTITLEMENT_TEXT[k].description).not.toBe('');
  }
});

test('PLAN_DEFAULTS match the brief', () => {
  const { basic, pro } = PLAN_DEFAULTS;
  expect(basic.limits).toEqual({ max_tables: 15, max_stations: 1, max_staff: 3, report_history_days: 30 });
  expect(pro.limits).toEqual({ max_tables: null, max_stations: null, max_staff: null, report_history_days: null });
  for (const k of BASIC_FEATURES) expect(basic.features[k] && pro.features[k]).toBe(true);
  for (const k of PRO_ONLY_FEATURES) expect([basic.features[k], pro.features[k]]).toEqual([false, true]);
});

test('resolveEntitlements applies overrides without mutating', () => {
  const base = PLAN_DEFAULTS.basic;
  const r = resolveEntitlements(base, [
    { key: 'combos', enabled: true },
    { key: 'qr_ordering', enabled: false },
    { key: 'max_tables', limitValue: null },
    { key: 'max_staff', limitValue: 5 },
  ]);
  expect(r.features.combos).toBe(true);
  expect(r.features.qr_ordering).toBe(false);
  expect(r.limits).toEqual({ max_tables: null, max_stations: 1, max_staff: 5, report_history_days: 30 });
  expect(base.features.combos).toBe(false);
  expect(base.limits.max_tables).toBe(15);
  expect(resolveEntitlements(base)).toEqual(base);
});

test('withinLimit', () => {
  expect(withinLimit(null, 1e6)).toBe(true);
  expect(withinLimit(15, 14)).toBe(true);
  expect(withinLimit(15, 15)).toBe(false);
  expect(withinLimit(0, 0)).toBe(false);
});
