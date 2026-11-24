/**
 * Entitlement keys, plan defaults and resolution.
 *
 * This file mirrors the database: table `entitlement_keys` (every key below, with its kind),
 * table `plan_features` (PLAN_DEFAULTS) and function `public.get_entitlements(shop_id)`
 * (resolveEntitlements). See docs/DATA-MODEL.md. Change both sides together:
 * supabase/tests/database/004_entitlements.test.sql and app/src/entitlements/keys.test.ts
 * assert the same key lists and defaults.
 *
 * Pure module: no React, no I/O. Hooks (`useFeature`, `useLimit`) live in ./hooks.tsx.
 */

/** Features on in both plans (Lapar Basic). */
export const BASIC_FEATURES = [
  'qr_ordering',
  'modifiers',
  'call_server',
  'approvals',
  'kitchen_board',
  'manual_pairings',
  'checkout_nudge',
  'manual_payments',
  'daily_summary',
  'menu_editor',
  'table_qr',
  'staff_pins',
] as const;

/** Features off in Basic and on in Pro. Each is built for real behind its key. */
export const PRO_ONLY_FEATURES = [
  'auto_pairings',
  'upsell_report',
  'combos',
  'promos',
  'timed_menus',
  'multi_language_menu',
  'multi_station',
  'printing',
  'takeaway',
  'bill_split',
  'custom_columns',
  'full_reports',
  'export_backup',
] as const;

export const FEATURE_KEYS = [...BASIC_FEATURES, ...PRO_ONLY_FEATURES] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const LIMIT_KEYS = ['max_tables', 'max_stations', 'max_staff', 'report_history_days'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export type EntitlementKey = FeatureKey | LimitKey;

export const PLAN_IDS = ['basic', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** The resolved object that drives both the UI and (in SQL form) the database checks. */
export interface Entitlements {
  features: Record<FeatureKey, boolean>;
  /** `null` means unlimited. */
  limits: Record<LimitKey, number | null>;
}

/** A per-shop override (table `shop_feature_overrides`). It replaces the plan value for one key. */
export type EntitlementOverride =
  | { key: FeatureKey; enabled: boolean }
  /** `limitValue: null` overrides the limit to unlimited. */
  | { key: LimitKey; limitValue: number | null };

export const isFeatureKey = (key: string): key is FeatureKey => (FEATURE_KEYS as readonly string[]).includes(key);
export const isLimitKey = (key: string): key is LimitKey => (LIMIT_KEYS as readonly string[]).includes(key);

function featureMap(enabled: readonly FeatureKey[]): Record<FeatureKey, boolean> {
  const map = {} as Record<FeatureKey, boolean>;
  for (const key of FEATURE_KEYS) map[key] = enabled.includes(key);
  return map;
}

/** Plan defaults, identical to the `plan_features` rows seeded by the schema migration. */
export const PLAN_DEFAULTS: Readonly<Record<PlanId, Entitlements>> = {
  basic: {
    features: featureMap(BASIC_FEATURES),
    limits: { max_tables: 15, max_stations: 1, max_staff: 3, report_history_days: 30 },
  },
  pro: {
    features: featureMap(FEATURE_KEYS),
    limits: { max_tables: null, max_stations: null, max_staff: null, report_history_days: null },
  },
};

/**
 * The plan's values, each replaced by its override when one exists (same rule as SQL
 * `get_entitlements`). Returns a fresh object; inputs are not mutated.
 */
export function resolveEntitlements(
  planDefaults: Entitlements,
  overrides: readonly EntitlementOverride[] = [],
): Entitlements {
  const resolved: Entitlements = {
    features: { ...planDefaults.features },
    limits: { ...planDefaults.limits },
  };
  for (const override of overrides) {
    if ('enabled' in override) resolved.features[override.key] = override.enabled;
    else resolved.limits[override.key] = override.limitValue;
  }
  return resolved;
}

/** Same rule as SQL `within_limit()`: may one more be added when `count` already exist? */
export const withinLimit = (limit: number | null, count: number): boolean => limit === null || count < limit;
