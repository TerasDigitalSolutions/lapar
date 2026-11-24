# Lapar build plan

Milestones M1 (demo), M2 (database, Basic **and** Pro), M3 (real Basic app), M3b (real Pro app), M4 (Teras admin), M5 (nightly job), split into 28 task cards over 7 waves. Each card is one Sonnet run in its own git worktree. Read first: `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, `app/src/data/types.ts`, `app/src/entitlements/keys.ts`, `DECISIONS.md`.

## Waves

Up to 4 cards per wave run in parallel; cards in a wave own disjoint files. The orchestrator merges, runs every check, then starts the next wave.

| Wave | Cards (parallel) |
| --- | --- |
| W1 | M1-A DemoData core · M1-B Foundations (UI kit, hooks, lib, view placeholders) · M1-C Demo offline + bundle guard · M2-A Schema |
| W2 | M1-D Customer view · M1-E Staff view · M1-F Kitchen board · M2-B Security, triggers, storage, seed |
| W3 | M1-G DemoData Pro · M1-H Manager view · M1-I Demo shell + demo E2E · M2-C Customer RPCs |
| W4 | M1-J Pro UI: customer + pickup board · M1-K Pro UI: staff + kitchen + printing · M1-L Pro UI: reports + export · M2-D Staff RPCs |
| W5 | M1-M Pro UI: owner editors · M2-E Owner + Pro RPCs · M3-A SupabaseData core + customer + local E2E harness · M4-A Admin SQL + Edge Function |
| W6 | M3-B SupabaseData staff/owner/auth · M3-C Real routes + auth screens · M3b-A SupabaseData Pro · M5-A Photo sync script |
| W7 | M3-D Basic E2E + DB deploy workflow · M3b-B Pro E2E · M4-B Admin UI · M5-B Nightly workflow + backup |

Milestones complete: M1 after W5 (Basic demo usable after W3), M2 after W5, M4/M3/M3b/M5 after W7.

## Rules for every card

- Edit only files under **Owns**. Everything else is read-only. `app/src/data/types.ts` and `app/src/entitlements/keys.ts` are the contract: if your card cannot work without changing them, stop and report the exact change to the orchestrator.
- No new npm dependencies (only M1-C may uninstall two). No new Python packages except Pillow (M5-A).
- UI: strings through `defineMessages`/`useT` (feature `messages.ts`), money through `lib/money.ts`, storage through `lib/storage.ts`, touch targets ≥ 48 px, nothing dragged, one-handed on a phone, `useData()` only (never import an implementation from a view).
- SQL: DATA-MODEL section 1 conventions (security definer, `set search_path = ''`, schema-qualified names, error codes, camelCase JSON, explicit grants). Never edit a merged migration.
- Tests sit next to the code (`*.test.ts(x)` under `app/src`, pgTAP under `supabase/tests/database`). Commit on your worktree branch; do not push or merge.

Check commands used below:

| Name | Command |
| --- | --- |
| APP | `npm run typecheck && npm run lint && npm test` |
| BUILD | `npm run build` (typecheck + Vite build + demo guard) |
| E2E-DEMO | `npm run e2e` (builds, previews, runs `e2e/` except `e2e/local`) |
| DB | `supabase db reset && supabase test db` (Docker Desktop running, `supabase start` once) |
| E2E-LOCAL | `supabase start` then `npm run e2e:local` (from W5) |

## Orchestrator: before W1 and after each wave

**Before W1:** M0 merged and green. `config.ts` must not gain a WhatsApp value (owner decision: it lives in the database). Docker Desktop running for DB cards.

| After | Integrate and check |
| --- | --- |
| W1 | APP, BUILD (look for the `[demo-guard]` line), E2E-DEMO, DB. CI now has the `db` job. |
| W2 | APP, DB. Views exist but the demo page is still the placeholder. |
| W3 | APP, BUILD, E2E-DEMO, DB. The Basic demo is usable: deploy so the partner can try it. |
| W4 | APP, BUILD, E2E-DEMO, DB. Check M1-K's staff overlay renders M1-J's `PickupBoardView`. |
| W5 | All checks plus E2E-LOCAL. BUILD's guard line must show `app supabase modules > 0` and `0` for demo and customer. The brief's M1 Done-when (M1-C and M1-I suites, plus a manual phone and tablet try) and M2 Done-when (DB suite) must hold. |
| W6 | All checks. Manual smoke on local Supabase: `npm run dev` with `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLIC_KEY` from `supabase status -o env`. |
| W7 | All checks. Hand Eshan the setup checklist (ARCHITECTURE section 13), then run `supabase-deploy` and the Pages deploy, then the nightly job by hand twice (M5 acceptance). |

---

## W1

### M1-A · DemoData core (Basic)

- **Goal:** a complete in-memory `LaparData` for every Basic flow, with the seed and persistence, that the demo and all UI tests run on.
- **Owns:** `app/src/data/demo/**` (create `index.ts`, `store.ts`, `seed.ts`, `history.ts` (stub), `events.ts`, `customer.ts`, `auth.ts`, `staff.ts`, `owner.ts`, `reports.ts`, `pro.ts` (stub), `admin.ts`, tests); `app/src/lib/money.ts`, `time.ts`, `status.ts`, `storage.ts`, `rng.ts` and their tests.
- **Reads:** `types.ts`, `keys.ts`, DATA-MODEL sections 6 and 11, ARCHITECTURE 3.1.
- **Depends on:** M0.
- **Steps:**
  1. `lib/storage.ts`: `readJson(key, fallback, area = 'local')`, `writeJson`, `removeKey`; every Web Storage access in try/catch; works when storage throws.
  2. `lib/money.ts`: `formatRM(sen)` → `"RM 12.30"`, `parseRM(text)` (string parsing, ≤ 2 decimals, else null), `roundCash(sen)` (DATA-MODEL `round_cash`), `splitEqual(total, n)` (remainder sen to the first shares). Tests: cash table 1231…1239, split 1000/3 = 334/333/333.
  3. `lib/time.ts` (Intl, `timeZone: 'Asia/Kuala_Lumpur'`): `mytParts(date)`, `mytToday(now)`, `mytDayOf(iso)`, `inWindow(window, at)` exactly like SQL `in_window` (wrap past midnight, weekday filter), `minutesSince(iso, now)`. Tests include a wrap and a weekday miss.
  4. `lib/status.ts`: `canMove(from, to, withColumn)` = the `advance_item` table; `customerStatus(status)` → `'waiting' | 'received' | 'cooking' | 'ready' | 'served' | 'cancelled'`. Full matrix test.
  5. `lib/rng.ts`: `mulberry32(seed)`.
  6. `store.ts`: `DemoState` = one array per table (camelCase rows mirroring the columns, Pro tables included) plus `plan`, `clock`, `version: 1`.
  7. `seed.ts`: Kopitiam Teras from DATA-MODEL section 11 — all categories, items, options, pairings, translations, Drinks station, Sets with components, Happy hour promo, windows — plus 10 tables `demo-table-01`…`10`, counter `demo-counter`, pickup token `demo-pickup`, staff Aminah 1234 and Ravi 5678, plan `basic`, `first_order`, nudge Drinks. Readable string ids (`item-teh-tarik`).
  8. `history.ts`: stub `generateHistory(state, today)` returning empty rows (M1-L fills it). `index.ts` merges its output at load and never persists it.
  9. `index.ts`: `createDemoData({ persist = true, now = () => new Date() } = {}): LaparDemoData`; load `localStorage['lapar-demo-v1']` (bad JSON or version → seed), save debounced 500 ms; `events.ts` emitter for `subscribeShop` (always `live`) and `onChange`; `getEntitlements` = `resolveEntitlements(PLAN_DEFAULTS[plan])`; `setPlan`, `setClock` (store only; M1-G uses it), `reset`.
  10. `customer.ts`, `staff.ts`, `owner.ts`, `reports.ts` (daily summary), `auth.ts` (demo owner/staff always signed in; `claimStaffSession` checks seed PINs), `admin.ts` (`listShops` → demo shop, `getPlatformSettings` → null number, rest `not_implemented`): every Basic rule of DATA-MODEL 6.1–6.4 — validation, rate limit, approval modes, list prices and option deltas, option snapshots, `line_no`, one open tab per table, merge of server calls, valid moves, `ready_at`/`served_at`, full payment with cash rounding, sold out, limits (`withinLimit`), duplicate PIN, `in_use` for non-empty category, `regenerateTableToken`. Pro paths throw `feature_not_enabled` when the plan lacks the key and `not_implemented` otherwise (M1-G). `getPickupBoard` → `not_implemented`. Uploads store the blob as a data URL (M1-G adds resizing).
  11. `pro.ts`: every `ProApi` method throws `not_implemented`.
- **Done when:** APP passes, with tests covering: place → approve → new → preparing → cooking → ready → served → paid (tab closed, rounding stored); each approval mode; rate limit; sold out; option min/max; `limit_reached` for the 16th table and 4th staff on Basic; `duplicate_pin`; partial payment on Basic → `feature_not_enabled`; persistence round trip; `createDemoData()` works when `localStorage` throws; `reset()` restores the seed.

### M1-B · Foundations: UI kit, data context, entitlements hooks, helpers, view placeholders

- **Goal:** the shared building blocks every view card uses.
- **Owns:** `app/src/ui/**`; `app/src/data/context.tsx`, `app/src/data/hooks.ts` (+ tests); `app/src/entitlements/hooks.tsx`, `messages.ts`, `keys.test.ts`; `app/src/lib/photo-url.ts`, `suggestions.ts`, `audio.ts`, `image.ts` (+ tests); placeholders `app/src/features/customer/CustomerView.tsx`, `features/staff/StaffView.tsx`, `features/kitchen/KitchenView.tsx`, `features/manager/ManagerView.tsx`, `features/admin/AdminView.tsx`, `features/pickup/PickupBoardView.tsx`.
- **Reads:** `types.ts`, `keys.ts`, `app/src/i18n/index.ts`, ARCHITECTURE 2, 4, 8, 9, 11.
- **Depends on:** M0.
- **Steps:**
  1. `ui/`: `Button` (primary, secondary, danger, ghost; `min-h-12`), `IconButton`, `Sheet` (bottom sheet, focus trap, Esc/backdrop close, `aria-modal`), `ConfirmDialog`, `ToastProvider`/`useToast`, `TabBar`, `Field` (label, input/textarea/select, error), `QtyStepper`, `Toggle`, `Segmented`, `Banner` (info/warn/error), `EmptyState`, `Loading`, `ErrorState` (maps `LaparErrorCode` to a message), `PhotoTile` (`resolvePhotoUrl`, `loading="lazy"`, initials placeholder), `ProBadge`, `ProLocked` (badge + explanation sheet using `useProCta`), `LimitBadge({ used, limitKey })` (hidden when unlimited); `ui/messages.ts`. Tailwind only.
  2. `data/context.tsx`: `DataProvider({ value })`, `useData()` (throws outside a provider).
  3. `data/hooks.ts`: `useLiveQuery(load, { shopId, tables, pollMs? })` exactly as ARCHITECTURE 8 (debounce 300 ms, reload on `offline → live`, on visible, on `online`), `usePolling(fn, ms)` (only while visible), `usePageVisible()`, `useOnline()`. Tests with a fake `subscribeShop`.
  4. `entitlements/hooks.tsx`: `EntitlementsProvider({ value })`, `useEntitlements`, `useFeature(key)`, `useLimit(key)`, `useShopEntitlements(shopId)` (loads `getEntitlements` once), `ProCtaProvider`/`useProCta()` with `{ kind: 'demo' } | { kind: 'whatsapp'; number: string } | { kind: 'neutral' }`.
  5. `entitlements/messages.ts`: label and one-line description for every feature and limit key (en). `keys.test.ts`: key lists, `PLAN_DEFAULTS` against the brief's table, `resolveEntitlements`, `withinLimit`.
  6. `lib/photo-url.ts` (ARCHITECTURE 11) + tests; `lib/suggestions.ts` `pickSuggestions({ item, itemsById, categoriesById, cartItemIds })` → up to 3, skipping missing, sold-out, unavailable-now, in-cart and self (the "once per dish per visit" set is the caller's) + tests; `lib/audio.ts` `unlockAudio`, `isAudioRunning`, `playOrderAlert`, `playCallAlert`, `vibrate` (no-ops without WebAudio); `lib/image.ts` `fitWithin(w, h, max)`, `resizeImage(blob, maxEdge, quality)` (canvas, WebP, JPEG fallback when `toBlob` returns another type), `blobToDataUrl` (test `fitWithin` only).
  7. Placeholders: each view file exports its component with the exact props of ARCHITECTURE 2 and renders "<name> — coming soon".
- **Done when:** APP passes.

### M1-C · Demo offline shell and bundle guard

- **Goal:** the demo page installs a service worker scoped to `/lapar/demo/`, works offline after one visit, has a home-screen icon, and the build fails if supabase-js reaches the demo or the customer route's static bundle.
- **Owns:** `build/demo-sw-plugin.ts`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `package.json` + `package-lock.json` (only `npm uninstall vite-plugin-pwa workbox-window`), `app/demo/index.html`, `app/src/demo-main.tsx`, `app/src/features/demo/DemoApp.tsx` (placeholder), `app/public/demo/**`, `e2e/demo/offline.spec.ts`.
- **Reads:** ARCHITECTURE 3.3, 3.4, 7; `e2e/smoke.spec.ts`.
- **Depends on:** M0.
- **Steps:**
  1. Write the plugin (ARCHITECTURE 3.4 and 7). Vite 8 bundles with Rolldown: use the Rollup-compatible hooks and `OutputChunk` fields (`generateBundle`, `isEntry`, `facadeModuleId`, `imports`, `dynamicImports`, `moduleIds`, `viteMetadata`); if a field is missing, derive the same data from `chunk.modules` and log the choice in DECISIONS.md. Contents: demo closure, `@supabase` guard for the demo closure and the customer route's static closure, the `[demo-guard]` log line, and `demo/sw.js` emitted with the precache list (closure chunks, their CSS/assets, `demo/index.html`, files under `app/public/demo/`), URLs prefixed with `base`, cache `lapar-demo-<hash8 of list>`. The worker source is a template string in the plugin.
  2. Register the plugin in `vite.config.ts`; add `build` to `tsconfig.json` `include`.
  3. ESLint `no-restricted-imports` rules from ARCHITECTURE 3.3 (flat config `files`/`ignores` blocks).
  4. `app/public/demo/manifest.webmanifest` (name "Lapar demo", `start_url`/`scope` `/lapar/demo/`, standalone, theme colour orange-700) and PNG icons 192, 512 and 180 (apple-touch) — a solid brand square with a white "L", generated once with a throwaway Node script using only `node:zlib` (commit the PNGs, not the script). Link them in `app/demo/index.html` with `theme-color` and a description.
  5. `demo-main.tsx`: in production register `BASE_URL + 'demo/sw.js'` with scope `BASE_URL + 'demo/'`; render `<DemoApp />`. Placeholder `DemoApp` keeps an `h1` "Lapar demo" (smoke test).
  6. Uninstall `vite-plugin-pwa` and `workbox-window` (replaced by the plugin; see DECISIONS).
  7. `e2e/demo/offline.spec.ts`: open `/lapar/demo/`, wait until `navigator.serviceWorker.controller` is set (reload once), `context.setOffline(true)`, reload, heading visible; assert no request left the origin.
  8. Prove the guard: temporarily add `import('@supabase/supabase-js')` in `DemoApp`, confirm BUILD fails with the guard error, revert. Note it in the commit message.
- **Done when:** BUILD passes and prints the guard line; APP; E2E-DEMO (smoke + offline) passes; `dist/demo/sw.js` lists only demo files.

### M2-A · Database schema

- **Goal:** every table, enum, constraint, index and utility function, with the entitlement data, from migrations.
- **Owns:** `supabase/config.toml`, `supabase/seed.sql` (create empty), `supabase/migrations/20261125000100_schema.sql`, `supabase/tests/database/001_schema.test.sql`, `.github/workflows/ci.yml` (add the `db` job only).
- **Reads:** DATA-MODEL 1–3, 5 (0100 rows), 12; `keys.ts`.
- **Depends on:** M0.
- **Steps:**
  1. `supabase init` if `config.toml` is missing (answer no to editor settings; leave `supabase/.temp` alone). Set `project_id = "lapar"`, `[db] major_version = 17` (must match the hosted project; Eshan confirms), `[auth] site_url = "http://127.0.0.1:5173/lapar/"`, `enable_anonymous_sign_ins = true`, `[auth.email] otp_expiry = 86400`.
  2. Migration 0100: `create extension if not exists pgcrypto with schema extensions`; default-privilege revokes (functions: `public`, `anon`, `authenticated`; tables: `anon`, `authenticated`); `revoke all on all tables in schema public from anon, authenticated`; enums; tables in FK order with every constraint and index of section 3; RLS enabled on every table; `new_token`, `try_uuid`, `myt_today`, `in_window`, `round_cash` (+ `grant execute` on `new_token`, `try_uuid` to `authenticated`); rows for `entitlement_keys` (29), `plans` (2), `plan_features` (58, = `PLAN_DEFAULTS`), `platform_settings` (1).
  3. `001_schema.test.sql`: `has_table` for all 30 tables; RLS on for all; 25 feature + 4 limit keys; `plan_features` values equal `PLAN_DEFAULTS`; `round_cash` cases; `in_window` normal, wrapping and weekday cases; `new_token()` is 24 url-safe chars; composite FK rejects an item of shop A pointing at a category of shop B; second open tab for one table fails; duplicate token fails; negative price fails; photo state checks.
  4. `ci.yml` `db` job: checkout, `supabase/setup-cli@v1` with `version: 2.120.0`, `supabase start`, `supabase test db`.
- **Done when:** DB passes.

## W2

### M1-D · Customer view (Basic)

- **Goal:** the whole Basic customer experience on `LaparData`.
- **Owns:** `app/src/features/customer/**` except `index.tsx`.
- **Reads:** `types.ts`, `ui/`, `data/context.tsx`, `data/hooks.ts`, `lib/*`, `data/demo/` (tests), brief "Customer".
- **Depends on:** M1-A, M1-B.
- **Steps:**
  1. `CustomerView({ tableToken })`: load `getMenu`; header (logo, shop name, table label); sticky category chips in shop order; item rows (`PhotoTile`, name, `formatRM(effectivePriceSen)`); sold-out items greyed and not tappable; empty categories hidden. `not_found` → "This QR code is no longer valid"; inactive shop → "Not taking orders".
  2. Item sheet: option groups (radio when max 1, checkboxes otherwise, min/max enforced, required marked), quantity stepper, note with 140-character counter, live line price. Add.
  3. After Add: suggestion bottom sheet via `pickSuggestions` (up to 3, one tap adds with `suggestedFromItemId`, "No thanks"), shown once per dish per visit (sessionStorage set per token).
  4. Cart (sessionStorage per token): change qty, remove, total, Place order. Checkout nudge: with `checkout_nudge`, a `nudgeCategoryId` and no cart item from it, show that category once per visit before sending.
  5. Errors on place: `sold_out`/`item_unavailable` → reload menu, drop the line, explain; `rate_limited`, `shop_inactive`, `network` messages.
  6. Status view: orders and lines with customer labels (`customerStatus`), running bill (`totalSen`, plus pending), `usePolling(getTab, 10000)`.
  7. Call server: Bill, Water, Other (note sheet); confirmation and the open requests list.
- **Done when:** APP passes, with Testing Library tests on `createDemoData({ persist: false })`: required option blocks Add; suggestions skip in-cart items and show once; nudge once; order shows "Waiting for approval"; repeat call merges.

### M1-E · Staff view (Basic)

- **Goal:** approvals, alerts, server calls, to-serve strip, tables and payments, sold-out switches, and the PIN form.
- **Owns:** `app/src/features/staff/**` except `index.tsx`.
- **Reads:** as M1-D; brief "Staff".
- **Depends on:** M1-A, M1-B.
- **Steps:**
  1. `StaffView({ shopId })` with `TabBar`: Orders, Kitchen (`<KitchenView shopId>`), Tables, Sold out; last tab remembered per device.
  2. Orders: pending approvals (table or pickup number, lines, minutes waiting, Approve, Reject → reason sheet with quick reasons and free text ≤ 140); server calls (table, reason, note, age, tap count; Acknowledge, Done); To-serve strip (`listReadyLines`, tap → `advanceItem(id, 'served')`). Data through `useLiveQuery`.
  3. `useStaffAlerts`: sound and vibration on a new pending order or call (different sounds), repeated every 30 s while any is unhandled; "Tap to enable sound" banner until `unlockAudio`.
  4. Tables: tiles with open tab total; tab detail sheet (lines by order, total, pending warning) → Mark paid → Cash / DuitNow QR / Card / Other; cash shows `roundCash` total and the rounding; `recordPayment({ tabId, method })`.
  5. Sold out: items by category with toggles.
  6. `StaffPinForm({ onSubmit(shopSlug, pin) })`: shop code (remembered), PIN pad 4–6 digits, messages for `invalid_pin`, `pin_locked` (with time), `not_found`.
- **Done when:** APP passes, with tests: approve moves the order off the list; reject needs a reason; cash payment shows the rounded total and closes the tab; sold-out toggle; PIN form validation.

### M1-F · Kitchen board (Basic)

- **Goal:** the kitchen tablet board with Start shift, banners and live reloads.
- **Owns:** `app/src/features/kitchen/**`.
- **Reads:** as M1-D; ARCHITECTURE 8, 9; brief "Kitchen board", "Kitchen tablet".
- **Depends on:** M1-A, M1-B.
- **Steps:**
  1. `columns.ts` (pure, tested): `effectiveColumns(dto.columns)`, `columnIndexOf(line, columns)` (`columnId`, else first column of its status), `nextMove(line, columns)` (last column → `served`), `prevMove`, `ageClass(minutes)` (≥ 10 amber, ≥ 20 red). Written generically so custom columns work unchanged.
  2. `KitchenView({ shopId })`: Start shift overlay (unlock audio, wake lock re-requested on visible, fullscreen); banners (sound off, wake lock unavailable, offline); board from `getBoard(shopId, null)` via `useLiveQuery(['orders','order_items'])`; columns side by side on tablets, stacked sections on phones; fixed column labels from i18n.
  3. Card: "qty × name", options, note, table label or pickup number, "position of positionOf", minutes since `approvedAt` (corrected by `serverNow`, refreshed every 30 s), colour by age. Tap → next move; "⋯" menu → back or cancel (confirm).
- **Done when:** APP passes, with `columns.ts` unit tests and a component test that taps a card through to Ready and uses back and cancel.

### M2-B · Security, triggers, storage, seed

- **Goal:** helpers, entitlement functions, triggers, grants, RLS, Realtime publication, Storage bucket and the seed.
- **Owns:** `supabase/migrations/20261125000200_security.sql`, `supabase/seed.sql`, `supabase/tests/database/002_helpers.test.sql`, `003_rls_isolation.test.sql`, `004_entitlements.test.sql`, `005_privileges.test.sql`, `006_limits_triggers.test.sql`, `007_storage.test.sql`.
- **Reads:** DATA-MODEL 4, 5, 7, 8, 9, 11.
- **Depends on:** M2-A.
- **Steps:**
  1. Helpers marked 0200 in section 5; `get_entitlements`; triggers of section 4 (not `auto_pairings_on_gain`); grants and policies of section 7 (functions granted as they exist now); publication; bucket and policy.
  2. `seed.sql` per section 11 (users with identities, shops A and B, menu, options, pairings, shop B Pro config, tables, staff with bcrypt PINs). No history.
  3. Tests: `current_shop_ids` for owner, live session, expired session, deactivated staff; RLS isolation for every service and menu table (owner A sees no shop B rows; device-a with a session in A sees A only; outsider sees nothing; anon `select` raises permission denied); `get_entitlements` for A and B, override changes it, outsider `forbidden`; privileges (every function `anon` can execute is in the five-RPC allowlist; `anon` has no table privilege; `authenticated` has none on `staff_pins`, `staff_sessions`, `pin_attempts`, `pickup_counters`, `platform_settings`; every `security definer` function in `public` has a `search_path` setting); limits (16th table on A, second station on A, 4th staff on A → `limit_reached`; counters do not count), counter and combo on A → `feature_not_enabled`, last station cannot be deactivated; owner A can update `shops.name` but not `plan_id` or `tables.token`; storage insert into own folder works, other shop's folder fails.
- **Done when:** DB passes.

## W3

### M1-G · DemoData Pro

- **Goal:** every Pro rule in DemoData so all Pro screens work in the demo.
- **Owns:** `app/src/data/demo/**`; `app/src/lib/pricing.ts` (+ test).
- **Reads:** DATA-MODEL 6.1, 6.3, 6.5, 11; `lib/image.ts`.
- **Depends on:** M1-A.
- **Steps:**
  1. `lib/pricing.ts`: `promoPrice(listSen, promo)`, `bestPromo(item, promos, at)` with the SQL formula. Tests mirror the pgTAP cases (220 at 20% → 176; 225 at 15% → 191; amount floor at 0).
  2. Demo clock: `setClock` presets (breakfast 08:30, lunch 12:30, afternoon 15:30 today MYT; real) feed menu windows and promos only.
  3. `getMenu`: translations, windows/`availableNow`, promo prices, combos, auto suggestions (`computeAutoPairings` over history: 90 days, support ≥ 3, top 3 by confidence) — each only when its feature is on.
  4. `placeOrder`: promos, combo expansion (combo line + component lines routed by station), timed-menu check, station routing (`multi_station`), counter orders (new tab, pickup number per MYT day, `pickupAt` today only); `getTab` with `tabId` for counters; `getPickupBoard`.
  5. `advanceItem` with `columnId` (`custom_columns`), `recordPayment` amount and item splits with the `mixed_split` rule (`bill_split`).
  6. `pro.ts`: stations (limit), board columns (validation of `set_board_columns`), promos, combo components, pickup token; report and export methods delegate to `reports.ts` functions that still throw `not_implemented` (M1-L).
  7. Uploads: `resizeImage(blob, 400, 0.7)` then data URL.
- **Done when:** APP passes, with tests for each rule above and a Basic-plan test that every Pro path throws `feature_not_enabled`.

### M1-H · Manager view (Basic)

- **Goal:** all Basic owner screens, with slots for Pro sections.
- **Owns:** `app/src/features/manager/**` except `index.tsx`; `app/src/lib/qr.ts` (+ test).
- **Reads:** as M1-D; brief "Owner".
- **Depends on:** M1-A, M1-B.
- **Steps:**
  1. `ManagerView({ shopId })`: section nav (Today, Menu, Tables, Staff, Settings, Plan, then Pro: Reports, Upsell, Promos, Stations & columns, Takeaway, Export). Create `features/manager/pro/ReportsSection.tsx`, `UpsellSection.tsx`, `ExportSection.tsx`, `PromosSection.tsx`, `StationsSection.tsx`, `TakeawaySection.tsx` (each `({ shopId })`, renders `<ProLocked>` when its feature is off, else "coming soon") and `ItemProFields.tsx`, `CategoryProFields.tsx`, `GroupProFields.tsx`, `OptionProFields.tsx` (each `({ draft, onDraftChange, editor })` for the matching `*Input`; render nothing). Editors render these slots and save whatever they put in the draft.
  2. Menu: categories with up/down reorder, add, rename, delete (`in_use` message); items per category with up/down; item sheet (name, description, price via `parseRM`, category, active, sold out, photo → `resizeImage` + `uploadItemPhoto`); option groups and options (min/max checks); Suggestions: up to 3 ordered items and the nudge category.
  3. Tables: list with `LimitBadge`, add, rename, deactivate/reactivate, QR (`lib/qr.ts`: `tableQrUrl(token)` = `${SITE_BASE_URL}#/t/${token}`, `qrSvg(text)` via `qrcode`), print an A4 sheet (print CSS grid: label, shop name, "Scan to order"), regenerate (confirm: old code stops working).
  4. Staff: list with `LimitBadge`, add (name + PIN), reset PIN, deactivate/reactivate.
  5. Settings: name, logo upload, approval mode.
  6. Today: date input limited to the report window (from `useLimit('report_history_days')`), sales, orders, average bill, top 5.
  7. Plan: plan name, feature list with locked Pro features, "Ask Teras" WhatsApp link from `getShopPlan().askTerasWhatsapp` or a neutral message; wrap the subtree in `ProCtaProvider` with the same choice.
- **Done when:** APP passes, with tests: add and edit an item; reorder; limit badge hidden on Pro; QR URL format; Today date bounds; Ask Teras hidden when the number is null.

### M1-I · Demo shell and demo E2E

- **Goal:** the sales demo page and its Playwright suite (brief M1 Done-when).
- **Owns:** `app/src/features/demo/**`, `e2e/demo/flow.spec.ts`, `e2e/demo/plan-reset.spec.ts`, `e2e/smoke.spec.ts`, `playwright.config.ts`.
- **Reads:** brief "Demo mode"; ARCHITECTURE 5.
- **Depends on:** M1-D, M1-E, M1-F, M1-C (M1-H's view appears automatically after W3).
- **Steps:**
  1. `DemoApp`: one `createDemoData()`; `DataProvider`; `EntitlementsProvider` from the plan; `ProCtaProvider` `{ kind: 'demo' }`; `ToastProvider`.
  2. Top bar: Plan (Basic, Pro), View (Customer, Staff, Manager), clock preset (only on Pro), Reset (confirm), Simulate rush / Stop (about 12 orders and 5 calls over about 2 minutes from other tables, seeded RNG, using the customer API).
  3. ≥ 1024 px: customer view in a phone frame on the left (table picker: Table 1–10, Counter when takeaway is on), Staff or Manager on the right. Narrower: one view; toasts for activity in the hidden views ("New order from Table 4", "Table 2: water").
  4. `playwright.config.ts`: projects `phone` (390×844, touch) and `tablet` (1280×800) for `e2e/demo/**`; keep the smoke test in one project.
  5. E2E: tablet — order on the left, approve on the right, move New → Preparing → Cooking → Ready, serve, customer shows Served, mark paid; phone — switch views, toast appears; plan switch shows then hides a Pro badge; Reset restores the seed; no off-origin requests.
- **Done when:** BUILD and E2E-DEMO pass.

### M2-C · Customer RPCs

- **Goal:** the five anon RPCs with Basic and Pro behaviour.
- **Owns:** `supabase/migrations/20261125000300_customer_rpcs.sql`; tests `010_get_menu`, `011_place_order`, `012_get_tab`, `013_call_server`, `014_pickup_board` (`.test.sql`).
- **Reads:** DATA-MODEL 5, 6.1, 7, 11.
- **Depends on:** M2-B.
- **Steps:** implement 6.1, `next_pickup_no`, `tab_money`; grant the five RPCs to `anon`, `authenticated`. Tests (set approval mode, plan or promo times with `update` as postgres inside the test transaction):
  - get_menu: unknown token `not_found`; inactive shop flag; A has no combos/translations/windows/promo; B has them; sold-out flag; suggestions in position order.
  - place_order: price from the database even if the line JSON carries price fields; option deltas; required group missing, too many options, option of another item → `invalid_input`; sold out; inactive item; other shop's item → `item_unavailable`; 31 lines; 6th order in 5 minutes → `rate_limited`; every approval mode; first_order auto-approves after the first approval; counter orders on B get pickup numbers 1, 2; Set A expands with Teh tarik routed to Drinks on B and everything to Kitchen on A; promo window covering now → 176 sen; category window excluding now → `item_unavailable`.
  - get_tab: table A1's token never shows A2's tab; counter needs `p_tab_id`; totals split approved/pending.
  - call_server: second tap merges (`tapCount` 2), re-opens an acknowledged call.
  - pickup board: preparing → ready → gone; `takeaway` overridden off on B → `feature_not_enabled`.
- **Done when:** DB passes.

## W4

### M1-J · Pro UI: customer and pickup board

- **Goal:** the customer side of every Pro feature and the pickup board screen.
- **Owns:** `app/src/features/customer/**` and `app/src/features/pickup/**`, except both `index.tsx`.
- **Depends on:** M1-D, M1-G.
- **Steps:**
  1. Language switch EN / BM / 中文 when `multi_language_menu`: `setLocale`, menu text from `translations[lang]` with fallback; add `ms` and `zh` drafts to the customer messages (comment `// draft: needs native review`).
  2. Promo: struck-through list price, promo price, promo name.
  3. Sets: items with components listed, no options, note allowed.
  4. Timed menus: unavailable categories greyed with "Available 06:00–11:30", items not addable.
  5. Counter token → takeaway mode: "Takeaway" header, pickup time (ASAP or today in 15-minute steps), big pickup number after ordering, "My orders" (tab ids per counter token in storage, each polled with `getTab(token, tabId)`).
  6. Auto suggestions labelled "Frequently ordered together".
  7. `PickupBoardView({ boardToken })`: two big columns, Preparing and Ready, polled every 5 s, fullscreen button, en/ms/zh strings.
- **Done when:** APP passes, with tests for language switch, struck price, set ordering, counter pickup number, pickup board numbers.

### M1-K · Pro UI: staff, kitchen and printing

- **Goal:** stations, custom columns, 58 mm printing, bill splitting and takeaway on the staff side.
- **Owns:** `app/src/features/staff/**` except `index.tsx`; `app/src/features/kitchen/**`; `app/src/features/print/**`.
- **Depends on:** M1-E, M1-F, M1-G.
- **Steps:**
  1. Station picker on the kitchen board when `multi_station` (remembered per device); `getBoard(shopId, stationId)`.
  2. Custom columns from `BoardDTO.columns`; moves pass `columnId`.
  3. `features/print/`: `PrintReceipt` (kitchen ticket per order and station; bill with lines, total, payments, cash rounding) rendered into a print-only root; `print.css` with `@page { size: 58mm auto; margin: 0 }`; preview sheet styled as a thermal receipt; buttons "Print ticket" (after approve and in the card menu) and "Print bill" (tab detail), gated by `printing`.
  4. Bill split in tab detail (`bill_split`): by item (select unpaid lines, method, pay) and equally (2–10 people, `splitEqual` of the remaining balance, pay each share with its own method; cash rounding per payment); payment list, remaining, closes when paid. Basic shows `ProLocked`.
  5. Takeaway: pickup numbers and times in approvals and tables; counter tabs listed; "Open pickup board" overlay rendering `PickupBoardView` with the shop's `pickupBoardToken` (`owner.getShopSettings`).
- **Done when:** APP passes, with tests: equal split of RM 10.00 three ways → 334/333/333 and the tab closes; item split; column moves; ticket renders in a 58 mm container; station picker.

### M1-L · Pro UI: reports, upsell, export, and demo history

- **Goal:** full reports, upsell report and exports, plus the demo's 30-day history and report maths.
- **Owns:** `app/src/features/manager/pro/ReportsSection.tsx`, `UpsellSection.tsx`, `ExportSection.tsx` (+ tests); `app/src/data/demo/history.ts`, `app/src/data/demo/reports.ts` (+ tests); `app/src/lib/csv.ts`, `app/src/lib/backup.ts` (+ tests).
- **Depends on:** M1-G, M1-H.
- **Steps:**
  1. `history.ts`: DATA-MODEL 11 "History" rules with `mulberry32` per day; deterministic; relative to today.
  2. `reports.ts`: `dailySummary` (keep), `salesReport`, `upsellReport`, `exportMeta`, `exportOrders` with the SQL definitions (6.4, 6.5) and the report window.
  3. `lib/csv.ts`: `toCsv(rows, columns)` with RFC 4180 quoting and a UTF-8 BOM. `lib/backup.ts`: `downloadTarget: BackupTarget` (object URL + anchor) and `backupTargets()` → `[downloadTarget]`.
  4. Reports section: date range (default last 30 days, clamped), totals, sales by day and by hour (CSS bars), best 5 and worst 5 sellers, prep times. Upsell section: month picker, RM earned, adds, rows with take-up rate. Export section: range; Orders CSV, Payments CSV, Sales-by-day CSV, Full JSON (meta + orders paged by 93 days from the shop's creation); each saved through a chosen `BackupTarget` (only "Download to this device" in v1).
- **Done when:** APP passes, with tests: history identical on two runs and covering 30 days; report totals equal the sum of days; CSV quoting; JSON export contains meta and orders.

### M2-D · Staff RPCs

- **Goal:** staff sessions, approvals, board, moves, payments, server calls and sold-out RPCs.
- **Owns:** `supabase/migrations/20261125000400_staff_rpcs.sql`; tests `020_staff_session`, `021_approvals`, `022_board_advance`, `023_payments`, `024_requests_sold_out` (`.test.sql`).
- **Reads:** DATA-MODEL 6.2, 6.3, 7.
- **Depends on:** M2-C.
- **Steps:** implement 6.2 and 6.3 and grant them to `authenticated`. Tests:
  - PIN: right PIN → session expiring in ~16 h; 5 wrong → `pin_locked`, persisted; right PIN while locked → `pin_locked`; after the lock (set `locked_until` in the past) right PIN works; unknown slug `not_found`; no `auth.uid()` → `not_signed_in`; `my_staff_session`, `end_staff_session`.
  - Approvals: outsider and staff of B `forbidden`; pending only; lines become `new`/`cancelled`; `approved_by_staff_id` set.
  - Moves: whole matrix; `ready_at`/`served_at`; same status without a column → `invalid_transition`; a column on A → `feature_not_enabled`; a column of another station → `invalid_input`; B with columns works. Board positions "n of m" and station filter; fixed columns on A.
  - Payments: A full cash 1233 → rounding +2, tab closed with totals; partial on A → `feature_not_enabled`; B equal split closes on the last share; by item; `mixed_split`; `pending_orders`; `tab_closed`.
  - Calls acknowledge/done; sold-out switch only for members of that shop.
- **Done when:** DB passes.

## W5

### M1-M · Pro UI: owner editors

- **Goal:** the owner's Pro editing screens.
- **Owns:** `app/src/features/manager/pro/**` except M1-L's three sections.
- **Depends on:** M1-H, M1-G.
- **Steps:**
  1. Promos: list, create/edit/delete (name + translations, percent/amount, value, days, start/end, items, active).
  2. Stations & columns: stations add/rename/deactivate with `LimitBadge`; per-station column editor (rename, add after a column with a core status, remove extra columns, up/down within the rules; every status keeps one column) saved with `setBoardColumns`.
  3. Takeaway: create the counter (`saveTable` kind counter) and show its QR; pickup board link, its QR and regenerate.
  4. `ItemProFields`: station select (`multi_station`), "Set meal" toggle (`combos`) with a "Set contents" sheet that saves through `setComboComponents` (existing items), ms/zh name and description (`multi_language_menu`). `CategoryProFields`: window from/to and days (`timed_menus`), translations. `GroupProFields`, `OptionProFields`: translations.
- **Done when:** APP passes, with tests: the column editor refuses to remove a status's last column; promo save; set contents save.

### M2-E · Owner and Pro RPCs, cron, seed history

- **Goal:** the owner RPCs, every Pro owner RPC, reports, exports, auto pairings and the seeded history.
- **Owns:** `supabase/migrations/20261125000500_owner_rpcs.sql`; `supabase/seed.sql` (append the history section only); tests `030_owner_staff_tables`, `031_menu_editor_pairings`, `032_reports`, `033_pro_gates`, `034_auto_pairings_cron`, `035_exports` (`.test.sql`).
- **Reads:** DATA-MODEL 4 (`auto_pairings_on_gain`), 5 (0500), 6.4, 6.5, 10, 11.
- **Depends on:** M2-D.
- **Steps:** implement, grant to `authenticated` (not `refresh_auto_pairings`), schedule cron, append history. Tests:
  - Staff management: 4th staff on A `limit_reached`; `duplicate_pin`; bad PIN; deactivation removes sessions; `set_staff_pin`.
  - `regenerate_table_token`: old token → `not_found` in `get_menu`. `set_item_pairings`: 4 items or another shop's item → `invalid_input`. `get_menu_editor` shape.
  - Daily summary for a known order today; A 31 days ago → `outside_report_window`; B unlimited. `get_shop_plan` usage and WhatsApp number.
  - Table-driven: every 6.5 RPC on A → `feature_not_enabled`; on B they work (column validation, promo, combo, pickup token).
  - Sales report: total = sum of days; 24 hours; zero sellers listed. Upsell counts. Export span > 93 days → `invalid_input`.
  - `refresh_auto_pairings`: B gets nasi-lemak → teh-tarik, A gets nothing; enabling the feature on A by override fills it; `cron.job` has `lapar-nightly`.
- **Done when:** DB passes. M2 Done-when holds (`supabase db reset` builds everything; RLS tests prove table-token scope, shop isolation and Pro gates).

### M3-A · SupabaseData core, customer path, local E2E harness

- **Goal:** the real data layer skeleton, the customer route on Supabase, and the local-Supabase Playwright setup.
- **Owns:** `app/src/data/supabase/**` (all modules; real `index.ts`, `client.ts`, `rest.ts`, `errors.ts`, `rows.ts`, `realtime.ts`, `customer.ts`, `getEntitlements`; stubs `auth.ts`, `staff.ts`, `owner.ts`, `pro.ts`, `admin.ts`, `upload.ts` throwing `not_implemented`); `app/src/features/customer/index.tsx`; `app/src/config.ts`; `playwright.config.ts` (add `testIgnore: ['**/e2e/local/**']`); `playwright.local.config.ts`; `e2e/local/customer.spec.ts`; `.github/workflows/ci.yml` (add `e2e-local`); `.github/workflows/deploy.yml` (add the public key env); `package.json` (add script `"e2e:local": "playwright test -c playwright.local.config.ts"` only).
- **Reads:** ARCHITECTURE 1, 3.2, 8, 13, 14.
- **Depends on:** M2-C; M1-D.
- **Steps:**
  1. `config.ts`: `SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://lxcnmbcqdafhmhqimkgj.supabase.co'`; key unchanged.
  2. Modules per ARCHITECTURE 3.2 (supabase-js only in `client.ts`, behind `import()`); `realtime.ts` per ARCHITECTURE 8.
  3. Customer route: `useParams().token` → `DataProvider(getSupabaseData())` → `CustomerView`.
  4. Unit tests: `errors.ts` mapping; `rest.ts` sends `apikey` and no `Authorization` (mock `fetch`).
  5. `playwright.local.config.ts`: parse `supabase status -o env` (`API_URL`, `PUBLISHABLE_KEY` or `ANON_KEY`); `testDir: 'e2e/local'`; `webServer` `vite --port 5173 --strictPort` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLIC_KEY`; `baseURL` `http://localhost:5173`.
  6. `customer.spec.ts`: `/lapar/#/t/lapar-local-a-table-01` shows Teh tarik; order Kopi O with "Ais"; status "Waiting for approval".
  7. CI `e2e-local`: node, `npm ci`, `supabase/setup-cli@v1` 2.120.0, `supabase start`, `npx playwright install --with-deps chromium`, `npm run e2e:local`. `deploy.yml` build env `VITE_SUPABASE_PUBLIC_KEY: ${{ vars.SUPABASE_PUBLIC_KEY }}`.
- **Done when:** APP; BUILD with guard line `demo … supabase=0; customer static … supabase=0; app supabase modules > 0`; E2E-LOCAL passes.

### M4-A · Admin SQL and the owner-link Edge Function

- **Goal:** admin RPCs, platform settings, and the function that creates owners and one-time links.
- **Owns:** `supabase/migrations/20261125000600_admin_rpcs.sql`; `supabase/tests/database/040_admin.test.sql`; `supabase/functions/admin-owner-link/index.ts`; `supabase/config.toml` (add `[functions.admin-owner-link] verify_jwt = false` only).
- **Reads:** DATA-MODEL 6.6, 6.7, 7.
- **Depends on:** M2-B.
- **Steps:**
  1. Implement 6.6; grant to `authenticated`.
  2. Tests: outsider and owner `forbidden`; create shop → Kitchen station, Drinks nudge, basic plan; `slug_taken`; bad slug; set plan; override with note changes `get_entitlements`, records `changed_by`; clear; deactivate → `get_menu` reports inactive and `place_order` `shop_inactive`; platform settings accept `+60 12-345 6789` as `60123456789`, reject letters.
  3. Edge Function per 6.7 (`npm:@supabase/supabase-js@2`, `Deno.serve`, CORS, JSON errors).
  4. Manual check against `supabase start`: sign in `admin@lapar.test` (`POST /auth/v1/token?grant_type=password`), call the function (invite `new-owner@lapar.test` for shop A) → `tokenHash`; `POST /auth/v1/verify` with `{type:'email', token_hash}` → session; same call as owner-a → 403; reset for a non-owner → 404. Paste the curl sequence in the commit message.
- **Done when:** DB passes and the manual check behaves as listed.

## W6

### M3-B · SupabaseData staff, owner, auth and uploads

- **Goal:** real implementations behind every Basic method.
- **Owns:** `app/src/data/supabase/auth.ts`, `staff.ts`, `owner.ts`, `upload.ts` (+ tests).
- **Depends on:** M3-A, M2-D, M2-E.
- **Steps:** `auth.ts` (password sign-in, sign-out, `verifyOtp({ token_hash, type })`, `updateUser({ password })`, `signInAnonymously` before `claim_staff_session` when there is no session, map `{ok:false}` to `LaparError`, `my_staff_session`, `my_shops`, `is_platform_admin`); `staff.ts` (RPCs); `owner.ts` (direct table CRUD with `rows.ts` mappers and `.select()` returns, `reorder` as per-row updates, RPCs, never send `tables.token`); `upload.ts` (`resizeImage(1200, 0.8)`, path rules of DATA-MODEL 9, public URL, then the item or shop update). Unit tests with a fake client: claim mapping, category window mapping.
- **Done when:** APP and BUILD pass.

### M3-C · Real routes and auth screens

- **Goal:** the staff, manager, welcome and pickup routes on Supabase.
- **Owns:** `app/src/app/router.tsx`; `app/src/features/staff/index.tsx`, `features/manager/index.tsx`, `features/pickup/index.tsx`; `app/src/features/auth/**`.
- **Depends on:** M3-A; views from M1.
- **Steps:**
  1. Router: add `/welcome` (`features/auth`) and `/pickup/:token` (`features/pickup`).
  2. Staff route per ARCHITECTURE 5 (owner → shop picker → StaffView; else anonymous + `StaffPinForm`; `forbidden`/`not_signed_in` → PIN form; sign out).
  3. `features/auth`: `OwnerSignIn` (email, password, warning when the device holds a staff session), `WelcomeView` (reads `token_hash` and `type` with `useSearchParams`, `verifyLink`, set password ≥ 8 with confirmation, → `#/manage`; failure → "This link has expired or was already used. Ask Teras for a new one.").
  4. Manager route: `OwnerSignIn` → `myShops` → picker if several → `useShopEntitlements` → `EntitlementsProvider` + `ProCtaProvider` (from `getShopPlan`) → `ManagerView`; "No shop is linked to this account".
  5. Pickup route: `DataProvider(getSupabaseData())` → `PickupBoardView`.
- **Done when:** APP and BUILD pass, with component tests on a fake `LaparData` for the PIN path, the owner path and an invalid welcome link.

### M3b-A · SupabaseData Pro

- **Goal:** real `ProApi`.
- **Owns:** `app/src/data/supabase/pro.ts` (+ test).
- **Depends on:** M3-A, M2-E.
- **Steps:** stations (direct insert/update), `getBoardColumns` (direct select), `setBoardColumns`, `savePromo`, `setComboComponents`, `regeneratePickupBoardToken`, reports and exports (RPCs), `listPromos` (direct select with `promo_items(item_id)`), `deletePromo` (direct delete). Unit test for the promo row mapping.
- **Done when:** APP and BUILD pass.

### M5-A · Photo sync script

- **Goal:** the nightly photo job's logic, testable on its own.
- **Owns:** `scripts/photo_sync.py`, `scripts/test_photo_sync.py`, `scripts/requirements.txt` (`Pillow==` a current version).
- **Reads:** brief "Photos and the nightly job"; DATA-MODEL 3.3 (`items` photo checks), 9.
- **Depends on:** M2-A.
- **Steps:**
  1. Python 3.12, stdlib + Pillow. Env `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Headers: `apikey: <key>` always; `Authorization: Bearer <key>` only when the key starts with `eyJ` (legacy JWT).
  2. `prepare`: select `items` with `photo_state = 'staging'` (REST); download each; re-encode to ≤ 800 px WebP quality 80; write `app/public/menu/{shop_id}/{item_id}-{hash8}.webp` (hash8 = first 8 hex of SHA-256 of the output bytes); delete files under `app/public/menu/` that no item's `photo_url` references and this run did not write; write `photo-manifest.json` (`item_id`, `staging_url`, `new_path`, `object_path`).
  3. `publish --manifest FILE --site-base URL`: GET the first new photo on the site until HTTP 200 (10 tries, 30 s apart) else exit 1; per row `PATCH items?id=eq.<id>&photo_url=eq.<staging_url>` → `photo_url = new_path`, `photo_state = 'published'`; delete the processed objects (`DELETE /storage/v1/object/menu-staging` with `prefixes`). Any failure exits non-zero and marks nothing else.
  4. `--dry-run` prints actions without writing.
  5. `unittest`: naming and hash, aspect-preserving resize ≤ 800, orphan detection in a temp dir, staging URL → object path, header choice for `sb_secret_` vs JWT keys.
- **Done when:** `python3 -m unittest discover -s scripts -p 'test_*.py'` passes; `prepare --dry-run` against `supabase start` lists an item after you upload a staging photo for it (Studio or curl).

## W7

### M3-D · Basic end-to-end test and production DB deploy

- **Goal:** the M3 Done-when test and the workflow that ships migrations and the function.
- **Owns:** `e2e/local/basic-flow.spec.ts`, `e2e/local/owner-basics.spec.ts`, `.github/workflows/supabase-deploy.yml`.
- **Depends on:** M3-B, M3-C.
- **Steps:**
  1. `basic-flow.spec.ts` (Kopitiam Teras, two browser contexts): customer on Table 3 orders Teh tarik (Ais) and Nasi lemak → staff signs in (`kopitiam-teras`, PIN 1234) and approves → Kitchen tab moves each card New → Preparing → Cooking → Ready → To serve: served → customer page shows Served → Tables: Table 3 → Mark paid, Cash (rounded total shown) → tab closed → customer shows no open bill.
  2. `owner-basics.spec.ts`: owner-a signs in to `#/manage`, adds an 11th table, regenerates its QR, opens Today.
  3. `supabase-deploy.yml` per ARCHITECTURE 13 (`workflow_run` after CI on `main` when `supabase/**` changed, plus `workflow_dispatch`; `supabase db push --db-url "$SUPABASE_DB_URL"`; `supabase functions deploy admin-owner-link --project-ref lxcnmbcqdafhmhqimkgj` with `SUPABASE_ACCESS_TOKEN`).
- **Done when:** E2E-LOCAL passes (M3 Done-when); the workflow YAML parses (`ruby -ryaml -e 'YAML.load_file(ARGV[0])' .github/workflows/supabase-deploy.yml`).

### M3b-B · Pro end-to-end test

- **Goal:** prove the Pro features on Supabase.
- **Owns:** `e2e/local/pro-flow.spec.ts`.
- **Depends on:** M3b-A, M3-B, M3-C.
- **Steps (Restoran Contoh):** counter order (`lapar-local-b-counter-1`) shows a pickup number → staff (`restoran-contoh`, 2468) approves → `#/pickup/lapar-local-b-pickup-01` lists it under Preparing → Drinks board moves Teh tarik and Kitchen board moves Nasi lemak to Ready → pickup board shows Ready; Table 2 orders Set A → components on both stations; split the bill equally two ways → tab closes; owner-b opens Reports (renders) and downloads Orders CSV (Playwright download event); owner-b makes the promo all-day, a new order is charged the promo price.
- **Done when:** E2E-LOCAL passes.

### M4-B · Teras admin UI

- **Goal:** Eshan sets up a shop, invites its owner and changes its plan without SQL (M4 Done-when).
- **Owns:** `app/src/data/supabase/admin.ts`; `app/src/features/admin/**` (`AdminView.tsx`, `index.tsx`, messages, tests); `e2e/local/admin.spec.ts`.
- **Depends on:** M4-A, M3-A, M3-C.
- **Steps:**
  1. `admin.ts`: admin RPCs; `createOwnerLink` via `functions.invoke('admin-owner-link')`, building `OwnerLinkDTO.url` from `SITE_BASE_URL` (`expiresHours: 24`).
  2. `AdminView`: shops list (name, slug, plan, active, last order); create shop form (name, slug suggested from the name, owner email) → `createShop` then `createOwnerLink(id, email, 'invite')`; shop detail: owner emails, "Invite owner" and "Reset owner password" → link panel with Copy and "Share on WhatsApp" (`https://wa.me/?text=<message with link>`), plan select, overrides table (every key: plan value, override, note, changed by/at; add/edit/remove with a required note), activate/deactivate (confirm); platform settings: WhatsApp number.
  3. Route: `OwnerSignIn` → `isPlatformAdmin` → `AdminView`, else "Not authorised".
  4. `admin.spec.ts`: admin creates "Warung Ujian" (`warung-ujian`), invites `new-owner@lapar.test`, opens the link in a new context, sets a password, lands on `#/manage` showing Warung Ujian; admin sets plan Pro, adds an override with a note, sets a WhatsApp number; the owner's Plan page shows the "Ask Teras" link.
- **Done when:** APP and E2E-LOCAL pass.

### M5-B · Nightly workflow, backup and restore

- **Goal:** the brief's nightly job steps 1–9 and documented restore.
- **Owns:** `.github/workflows/nightly.yml`, `.github/workflows/deploy.yml`, `.github/workflows/ci.yml` (add the `python` job and a `ref` input only), `scripts/backup.sh`, `README.md` (Operations and Restore sections).
- **Depends on:** M5-A.
- **Steps:**
  1. `deploy.yml` and `ci.yml`: `workflow_call` input `ref` (string, default `''`); checkouts use `ref: ${{ inputs.ref || github.sha }}` (a reusable workflow otherwise builds the old commit). `ci.yml` `python` job runs the unit tests.
  2. `nightly.yml`: `schedule: '15 19 * * *'` + `workflow_dispatch`; `concurrency: nightly`. Jobs: `sync` (Python 3.12, Pillow, `photo_sync.py prepare`; if `git status --porcelain app/public/menu` is non-empty commit "chore: sync menu photos" and push to `main`; outputs `changed`, `sha`; manifest as artifact) → `deploy` (if changed: `uses: ./.github/workflows/deploy.yml` with `ref`, permissions `pages: write`, `id-token: write`, `contents: read`) → `publish` (if changed: `photo_sync.py publish` with the site base) → `backup` (`if: ${{ !cancelled() }}`, runs `backup.sh`) → `heartbeat` (if the last commit on `main` is older than 30 days, commit a timestamp to `.github/heartbeat`). Failures fail the run visibly.
  3. `backup.sh` (`set -euo pipefail`): `supabase db dump --db-url "$SUPABASE_DB_URL"` three times (`--role-only`, schema, `--data-only --use-copy`), `tar czf` them, `age -r "$AGE_PUBLIC_KEY"` → `lapar-YYYY-MM-DD.tar.gz.age`; clone `lapar-backups` with `BACKUP_REPO_TOKEN`, add the file, keep the newest 30, commit, push. Never write an unencrypted file into the site repo's working tree. `BACKUP_DRY_RUN=1` stops before the clone.
  4. README: secrets list, how to run the nightly job by hand, restore steps (decrypt with the private age key, untar, `psql` roles, schema, data into a fresh project, re-run `supabase-deploy`), repo-size note.
- **Done when:** `bash -n scripts/backup.sh`; every workflow parses with the `ruby -ryaml` command; unit tests pass; `BACKUP_DRY_RUN=1 AGE_PUBLIC_KEY=<throwaway> SUPABASE_DB_URL=<local> scripts/backup.sh` produces an encrypted file that decrypts with the throwaway key. **After merge (Eshan):** run the workflow by hand with no staged photo (no deploy job runs, a backup appears) and again after uploading a photo (deploy runs; next day the photo is served from Pages, the row is `published` and the staging object is gone).

---

## Coverage check (brief → cards)

| Brief requirement | Cards |
| --- | --- |
| Customer menu, item sheet, suggestions, nudge, cart, status every 10 s, call server, one tab per table | M1-D, M2-C, M3-A |
| Staff approvals (3 modes), alerts, calls, board, card details/colours, to serve, tables + cash rounding, sold out, PIN sessions + lockout | M1-E, M1-F, M2-C, M2-D, M3-B, M3-C |
| Owner menu editor, pairings + nudge, tables + QR + A4 + regenerate, staff + PINs, settings, Today (30 days), Plan + Ask Teras | M1-H, M2-E, M3-B, M3-C |
| Basic limits in the DB | M2-B triggers, M2-E RPC tests |
| Every Pro feature real behind its key (14 rows) | DB: M2-C/D/E; demo: M1-G, M1-L; UI: M1-J/K/L/M; real: M3b-A, M3b-B |
| Demo: top bar, side by side ≥ 1024, toasts, plan switch, rush, reset, storage try/catch, offline + icon, no network, no supabase-js, seed + deterministic history | M1-A, M1-C, M1-I, M1-L |
| Admin: list, create shop, owner invite and reset links (no email), plan, overrides with note/who/when, deactivate, WhatsApp setting | M4-A, M4-B |
| Nightly: photo move, deploy only on change, publish after 200, delete staging, encrypted backup, heartbeat, restore steps | M5-A, M5-B |
| Security: shop_id + RLS everywhere, browser never trusted, anon = 5 RPCs, PIN hashes unreadable, secret key server-only | M2-A, M2-B, M2-C, M4-A |
| Testing: pgTAP every policy/RPC; Playwright demo in CI; Playwright on local Supabase; unit tests named in the brief | all DB cards; M1-C, M1-I; M3-A, M3-D, M3b-B, M4-B; M1-A, M1-B |
| Kitchen tablet: Start shift, banners, reload on reconnect/visible | M1-B (`useLiveQuery`), M1-F |
