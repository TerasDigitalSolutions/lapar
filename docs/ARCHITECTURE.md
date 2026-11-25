# Lapar architecture

Read with `docs/DATA-MODEL.md` (database), `docs/PLAN.md` (who builds what) and `app/src/data/types.ts` (the data contract). Decisions and their reasons: `DECISIONS.md`.

## 1. System

| Part | Runs where | Talks to |
| --- | --- | --- |
| App page `/lapar/` (landing, customer, staff, owner, admin, pickup board) | GitHub Pages, hash router | Supabase only |
| Demo page `/lapar/demo/` | GitHub Pages, offline via its own service worker | Nothing (no network calls, no supabase-js) |
| Supabase (project `lxcnmbcqdafhmhqimkgj`, Singapore, Free) | Postgres + RLS + RPCs, Auth, Realtime, Storage, pg_cron, one Edge Function | — |
| Edge Function `admin-owner-link` | Supabase | Auth admin API with the secret key |
| GitHub Actions | `ci.yml`, `deploy.yml` (incl. the Supabase deploy job), `nightly.yml` | Pages, Supabase (secret key, DB URL), private repo `lapar-backups` |

Keys: the browser gets a **public client key** (`sb_publishable_…`; a legacy anon JWT also works) from `VITE_SUPABASE_PUBLIC_KEY` at build time. Server code gets a **secret key** (`sb_secret_…`, or the legacy service_role JWT) only from GitHub secrets or the Edge Function environment. New keys go on the `apikey` header only, never `Authorization: Bearer` (they are not JWTs). Legacy keys stop working at the end of 2026, so set up the new ones.

## 2. Source layout and ownership

```
app/index.html, app/demo/index.html       entry pages (M0)
app/src/main.tsx, app/src/demo-main.tsx   entry scripts (M0; demo-main → M1-C)
app/src/app/                              router shell, Layout (M0; router.tsx edits → M3-C)
app/src/config.ts                         SITE_BASE_URL, SUPABASE_URL, SUPABASE_PUBLIC_KEY (M0; env overrides → M3-A)
app/src/i18n/                             defineMessages/useT, setLocale (M0)
app/src/data/types.ts                     the contract (architect; changes need the orchestrator)
app/src/data/context.tsx, hooks.ts        DataProvider/useData, useLiveQuery, usePolling (M1-B)
app/src/data/demo/                        DemoData (M1-A core, M1-G Pro, M1-L reports/history)
app/src/data/supabase/                    SupabaseData (M3-A core+customer, M3-B staff/owner/auth, M3b-A pro, M4-B admin)
app/src/entitlements/keys.ts              keys, PLAN_DEFAULTS, resolveEntitlements (architect)
app/src/entitlements/hooks.tsx, messages.ts  EntitlementsProvider, useFeature, useLimit, feature labels (M1-B)
app/src/lib/                              pure helpers, each with a co-located *.test.ts
app/src/ui/                               shared components (M1-B)
app/src/features/<area>/                  one folder per area, own messages.ts
build/demo-sw-plugin.ts                   Vite plugin: demo service worker + bundle guard (M1-C)
e2e/                                      Playwright: e2e/demo/* (DemoData), e2e/local/* (local Supabase)
supabase/                                 config.toml, migrations/, tests/database/, seed.sql, functions/
scripts/                                  photo_sync.py, backup.sh (M5)
```

`lib/` modules: `money.ts` (formatRM, parseRM, roundCash, splitEqual), `time.ts` (MYT day, minutes, weekday, inWindow), `status.ts` (allowed item moves, customer status labels key), `storage.ts` (try/catch localStorage/sessionStorage), `rng.ts` (seeded PRNG) — M1-A; `photo-url.ts`, `suggestions.ts`, `audio.ts`, `image.ts` (resize/encode) — M1-B; `qr.ts` — M1-H; `pricing.ts` (promo price, mirrors SQL) — M1-G; `csv.ts`, `backup.ts` — M1-L.

### View entry points (stable signatures; M1-B creates placeholders, feature cards replace them)

| File | Export | Used by |
| --- | --- | --- |
| `features/customer/CustomerView.tsx` | `CustomerView({ tableToken }: { tableToken: string })` | `/t/:token` route, demo left pane |
| `features/staff/StaffView.tsx` | `StaffView({ shopId }: { shopId: string })` — tabs Orders, Kitchen, Tables, Sold out | `/staff` route, demo |
| `features/kitchen/KitchenView.tsx` | `KitchenView({ shopId }: { shopId: string })` | StaffView "Kitchen" tab |
| `features/manager/ManagerView.tsx` | `ManagerView({ shopId }: { shopId: string })` | `/manage` route, demo |
| `features/admin/AdminView.tsx` | `AdminView()` | `/admin` route |
| `features/pickup/PickupBoardView.tsx` | `PickupBoardView({ boardToken }: { boardToken: string })` | `/pickup/:token` route, staff overlay |
| `features/demo/DemoApp.tsx` | `DemoApp()` | `demo-main.tsx` (M1-C placeholder, M1-I real) |

Views never sign in, never read the URL and never create a data object: they get `useData()`, entitlements from `useFeature`/`useLimit`, and their ids as props. Route modules (`features/*/index.tsx`, default export, loaded lazily by `app/router.tsx`) do sign-in, read params and wrap the view in providers.

## 3. Data layer

```
UI (views) ── useData() ──► LaparData (types.ts)
                              ├── DemoData      createDemoData()   app/src/data/demo/index.ts
                              └── SupabaseData  getSupabaseData()  app/src/data/supabase/index.ts
```

### 3.1 DemoData (`createDemoData(): LaparDemoData`)

- One in-memory store of all rows (same shapes as the tables), seeded from `seed.ts` (Kopitiam Teras with Basic **and** Pro configuration: stations, sets, promo, windows, translations, counter; Pro parts are gated by the plan switch exactly like the database gates them).
- Implements every rule of the RPC spec in DATA-MODEL section 6 (approval modes, server prices, valid moves, limits, gates, split rules, pickup numbers) so the demo behaves like the real app. Throws the same `LaparError` codes.
- Persistence: live state (everything except generated history) saved to `localStorage['lapar-demo-v1']`, debounced 500 ms, through `lib/storage.ts` (every call in try/catch; works with storage blocked). Thirty days of history are regenerated deterministically on load (`history.ts`, seeded PRNG) relative to today, so reports never go stale. `reset()` clears storage and reseeds.
- Events: an in-memory emitter; `subscribeShop` reports `ShopChange`s and is always `live`. `onChange` fires on any change (used by the demo shell for toasts).
- `DemoControls`: plan (Basic/Pro), clock preset (real, breakfast 08:30, lunch 12:30, afternoon 15:30 for happy hour; affects only menu windows and promos), reset. Admin methods return the demo shop or throw `not_implemented`. Auth methods resolve as a signed-in demo owner/staff.
- No `fetch`, no `import()` of anything outside the demo graph, no analytics.

### 3.2 SupabaseData (`getSupabaseData(): LaparData`, singleton)

| Module | Job |
| --- | --- |
| `rest.ts` | `rpcAnon(fn, args)`: `fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey, 'Content-Type': 'application/json' } })`. Used by `customer.ts` so the customer route never loads supabase-js. |
| `client.ts` | `getClient()`: `await import('@supabase/supabase-js')` once, `createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })`. Only module that imports supabase-js. |
| `errors.ts` | `toLaparError(e)`: PostgREST `message` that is a `LaparErrorCode` → that code with `details` as detail; FK violation `23503` → `in_use`; HTTP 401/JWT errors → `not_signed_in`; `TypeError`/offline → `network`; else `unknown`. |
| `rows.ts` | snake_case row → camelCase row mappers for direct table reads/writes (categories `available_*` ↔ `window`, promos with `promo_items(item_id)` embed). |
| `customer.ts`, `auth.ts`, `staff.ts`, `owner.ts`, `pro.ts`, `admin.ts`, `realtime.ts`, `upload.ts` | One per `LaparData` part. RPC results are passed through (keys already match the DTOs). |
| `index.ts` | Composes the parts. M3-A writes it with stubs (`throw new LaparError('not_implemented')`) for parts later cards fill. |

Owner screens write menu, tables, stations, categories, options and shop settings straight to tables through PostgREST (RLS + column grants + triggers guard them); everything else is an RPC.

### 3.3 Import rules (enforced by ESLint `no-restricted-imports`, card M1-C)

| Code | May import | Must not import |
| --- | --- | --- |
| `app/src/data/supabase/client.ts` | `@supabase/supabase-js` | — |
| rest of `app/src/**` | — | `@supabase/supabase-js` |
| `features/**` except `features/*/index.tsx` and `features/demo/**` | `data/types`, `data/context`, `data/hooks` | `data/demo/**`, `data/supabase/**` |
| `features/demo/**` | `data/demo/**` | `data/supabase/**` |
| tests (`*.test.ts(x)`) anywhere | `data/demo/**` (as the test double) | `data/supabase/**` except tests inside `data/supabase/` |
| `app/src/demo-main.tsx` | `features/demo/**` | `app/router`, `data/supabase/**` |

### 3.4 Demo bundle guard (how CI proves the demo has no supabase-js)

`build/demo-sw-plugin.ts` (Vite plugin, `apply: 'build'`, `enforce: 'post'`), in `generateBundle`:

1. Find the entry chunk whose `facadeModuleId` ends with `/app/demo/index.html`; walk `imports` and `dynamicImports` recursively (the demo closure).
2. If any chunk in the closure has a module id containing `/node_modules/@supabase/` → `this.error(...)`: **the build fails**, so `npm run build` in CI fails.
3. Find the chunk whose `facadeModuleId` ends with `/app/src/features/customer/index.tsx` (the lazy customer route); walk **static** `imports` only; same check (the customer route must load supabase-js never; staff/owner paths load it via `import()`).
4. Log one line: `[demo-guard] demo chunks=N supabase=0; customer static chunks=M supabase=0; app supabase modules=K`. Reviewers check `K > 0` once SupabaseData exists (proves the detector sees supabase-js).
5. Emit `demo/sw.js` (section 7) with the demo closure as its precache list.

The Playwright demo suite also asserts at runtime that no request leaves the origin (`page.on('request')`).

## 4. Entitlements

| Step | Real app | Demo |
| --- | --- | --- |
| Source | `get_entitlements(shop_id)` (plan defaults + overrides, resolved in SQL) | `resolveEntitlements(PLAN_DEFAULTS[plan], [])` from the Plan switch |
| Loaded | Once per session by the route wrapper (`useShopEntitlements(shopId)` in `entitlements/hooks.tsx`) | On every plan change |
| Read by UI | `<EntitlementsProvider value>`; `useFeature(key): boolean`, `useLimit(key): number \| null` | same |
| Customer page | `MenuDTO.features` (limits are not needed) | same |
| Enforced | Every RPC/policy/trigger via `has_feature()` / `within_limit()`; UI checks are cosmetic | DemoData repeats the same checks |

Locked features render `<ProLocked feature>` (Pro badge; tap opens a sheet saying what Pro adds). The sheet's call to action comes from `ProCtaProvider`: demo → "Switch the plan to Pro to try it"; manager → "Ask Teras" WhatsApp link when `ShopPlanDTO.askTerasWhatsapp` is set, else a neutral "Ask Teras about Lapar Pro"; elsewhere → neutral text. Limit badges (`<LimitBadge used limitKey>`, e.g. "8 / 15") hide when the limit is null. A downgrade hides features; data stays.

## 5. Routing

Hash router (`app/src/app/router.tsx`), one lazy chunk per route.

| Route | Module (route wrapper) | Does |
| --- | --- | --- |
| `#/` | `features/landing` (M0) | Landing, "Try the demo" → `./demo/` |
| `#/t/:token` | `features/customer/index.tsx` (M3-A) | `DataProvider(getSupabaseData())` → `CustomerView`. A counter token switches the view to takeaway mode (counter ordering is this route). |
| `#/staff` | `features/staff/index.tsx` (M3-C) | Owner session → shop picker → `StaffView` (no PIN). Else anonymous sign-in + `StaffPinForm` (staff code, remembered per device, + PIN) → `StaffView`. Expired session or `forbidden` → back to the PIN form. |
| `#/manage` | `features/manager/index.tsx` (M3-C) | Email + password sign-in → `my_shops` → shop picker if several → load entitlements → `ManagerView`. |
| `#/admin` | `features/admin/index.tsx` (M4-B) | Sign-in → `is_platform_admin` → `AdminView`, else "Not authorised". |
| `#/welcome?token_hash=…&type=email\|recovery` | `features/auth/index.tsx` (M3-C) | `verifyLink` → set password → `#/manage`. Expired/used link → "Ask Teras for a new link". |
| `#/pickup/:token` | `features/pickup/index.tsx` (M3-C) | `PickupBoardView` (anon RPC, polls every 5 s). |

The demo page (`app/demo/index.html` → `demo-main.tsx` → `DemoApp`) has no router: a top bar (Plan, View: Customer/Staff/Manager, clock preset when Pro, Reset, Simulate rush/Stop). At ≥ 1024 px the customer view sits in a phone frame on the left and Staff or Manager on the right; below that one view shows at a time and the others raise toasts ("New order from Table 4").

QR codes encode `${SITE_BASE_URL}#/t/<token>` with `SITE_BASE_URL = https://terasdigitalsolutions.github.io/lapar/` (one config value). The pickup board link is `${SITE_BASE_URL}#/pickup/<token>`.

## 6. Auth

| Who | Flow |
| --- | --- |
| Customer | None. The table token in the URL is the only key; all calls are anon RPCs. |
| Staff device | `auth.signInAnonymously()` once per device, then `claim_staff_session(staff_code, pin)`. Session lasts 16 h; device keeps the anonymous user. PIN lockout per shop: 5 wrong tries → 10 minutes. |
| Owner | Email + password. Account created by the admin's one-time link (no email is ever sent: Supabase Free mail only reaches the Supabase team). |
| Teras admin | Email + password; listed in `platform_admins` (first admin inserted once by SQL, see section 13). |
| Owner links | Admin screen → Edge Function `admin-owner-link` → `{tokenHash, verifyType}` → link `#/welcome?token_hash=…&type=…` with Copy and "Share on WhatsApp" (`https://wa.me/?text=`). The welcome page calls `verifyOtp({ token_hash, type })` (no tokens in the URL hash, so no clash with the hash router; `detectSessionInUrl` is off). Same flow for password resets (`type=recovery`). Links live 24 h (Auth email OTP expiry). |

One browser holds one Supabase session: signing in as owner on a staff device ends its anonymous staff session (the sign-in form warns).

## 7. Offline demo and service worker

- `build/demo-sw-plugin.ts` emits `dist/demo/sw.js`: a small hand-written worker with the precache list inlined (demo HTML, every chunk/CSS/asset in the demo closure, `demo/manifest.webmanifest`, `demo/icons/*`), each URL prefixed with Vite `base`. Cache name includes a hash of the list.
- Install: `cache.addAll(list)`, `skipWaiting()`. Activate: delete other `lapar-demo-*` caches, `clients.claim()`. Fetch: same-origin GET in the list → cache first; navigations under the scope → cached `demo/index.html`; everything else → network (the demo makes none).
- Registered only in production from `demo-main.tsx`: `navigator.serviceWorker.register(BASE_URL + 'demo/sw.js', { scope: BASE_URL + 'demo/' })`. Scope `/lapar/demo/` means the app page is never controlled or cached.
- `app/public/demo/manifest.webmanifest` (`start_url` and `scope` `/lapar/demo/`, `display: standalone`) and 192/512 px PNG icons + `apple-touch-icon` give the home-screen icon.
- After one visit the demo works in airplane mode (Playwright: load, wait for `navigator.serviceWorker.ready` and a controlled reload, `context.setOffline(true)`, reload, place an order).

## 8. Realtime and reloads

- `subscribeShop(shopId, onChange, onState)`: one channel `shop:<id>` with `postgres_changes` (`event: '*'`, `schema: 'public'`, `filter: 'shop_id=eq.<id>'`) for `orders`, `order_items`, `service_requests`, `tabs`. Status `SUBSCRIBED` → `live`; `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` → `offline`.
- `useLiveQuery(load, { shopId, tables, pollMs? })` (M1-B): runs `load()`, reloads (300 ms debounce) on any matching change, **reloads fully when the state returns to `live` after `offline`, when the page becomes visible, and on `online`** — missed events are never trusted. Optional polling. Exposes `{ data, error, connection, reload }` for the offline banner.
- Customer page: no Realtime; `get_tab` every 10 s while `document.visibilityState === 'visible'` (`usePolling`). Pickup board: every 5 s.
- Payments touch `tabs.updated_at`, so partial payments reach other devices.

## 9. Kitchen tablet and alerts

- `KitchenView` shows a full-screen **Start shift** button once per page load: resumes the shared `AudioContext` (`lib/audio.ts`), requests a screen wake lock (again on every `visibilitychange` → visible), enters fullscreen.
- Banners: sound off (AudioContext not running), wake lock unavailable, connection offline.
- Staff alerts (`StaffView`): WebAudio beeps (orders: two short high tones; calls: one long low tone) plus `navigator.vibrate`, on a new pending order or call, repeated every 30 s while any stays unhandled. Staff phones show "Tap to enable sound" until audio is unlocked.
- Card colours from minutes since `approvedAt` (server-clock corrected with `serverNow`): amber ≥ 10, red ≥ 20.

## 10. i18n

M0's layer: each feature has `messages.ts` → `defineMessages('<namespace>', { en: {...}, ms?: {...}, zh?: {...} })` → `useT()`; `setLocale('en'|'ms'|'zh')` is global. English everywhere at launch. The customer and pickup namespaces also ship `ms` and `zh` drafts (marked `// draft: needs native review`) for the Pro language switch, which calls `setLocale` and picks menu text from `translations[lang]` with fallback to the default name. Feature names/descriptions for Pro sheets and the Plan page: `entitlements/messages.ts`.

## 11. Photos, logos and the photo URL helper

- Upload (owner): `lib/image.ts` resizes to ≤ 1200 px long edge, WebP 0.8 (JPEG if the browser cannot encode WebP), uploads to `menu-staging/{shop_id}/{item_id}/{uuid}.webp`, then sets `photo_url` = public staging URL and `photo_state = 'staging'`. Logos: `menu-staging/{shop_id}/logo/{uuid}.webp`, stay in Storage. DemoData stores a ≤ 400 px data URL instead.
- `resolvePhotoUrl(url, base?)` (`lib/photo-url.ts`): null → null; `http(s):`, `data:` and `blob:` URLs as is; a relative path (`menu/…`) → `new URL(path, base)` where `base` defaults to `location.origin + import.meta.env.BASE_URL` (so the demo never calls the live site). Images use `loading="lazy"` and a placeholder tile (initials) when there is no photo.
- Nightly job (M5) moves staging photos to `app/public/menu/{shop_id}/{item_id}-{hash8}.webp` and sets `photo_url` to that relative path.

## 12. Printing and export (Pro)

- Printing (`printing`): browser print only. A `PrintReceipt` component renders a kitchen ticket or a bill into a print-only root; `@media print` + `@page { size: 58mm auto; margin: 0 }`, monospace, 48 mm content width. Buttons call `window.print()`; on Android the system print dialog reaches Bluetooth printer apps. The demo shows the same preview styled as a thermal receipt. UI-only: there is no server data to gate beyond what staff can already read.
- Export (`export_backup`): CSV (`orders` one row per line, `payments`, `sales-by-day`) and a JSON full-shop export (`export_shop_meta` + `export_orders` in ≤ 93-day pages, from the shop's creation date). Files are built in the browser (`lib/csv.ts`: RFC 4180 quoting, UTF-8 BOM) and handed to a `BackupTarget` (`types.ts`). v1 has one target, "Download to this device" (`lib/backup.ts`). Other destinations are an open decision (DECISIONS.md); adding one means adding a `BackupTarget`.

## 13. Config, CI/CD and one-time setup

| Workflow | Owner | Does |
| --- | --- | --- |
| `ci.yml` | M0 (`web`: its `npm run e2e` already runs `e2e/demo/*`); jobs added by M2-A (`db`), M3-A (`e2e-local`), M5-B (`python`) | typecheck, lint, unit, build (with bundle guard), Playwright demo; `supabase start` + `supabase test db`; local-Supabase Playwright; Python unit tests |
| `deploy.yml` | M0; M3-A adds `VITE_SUPABASE_PUBLIC_KEY: ${{ vars.SUPABASE_PUBLIC_KEY }}`; M5-B adds `inputs.ref` | On `main` after CI: build, deploy Pages. Reusable (`workflow_call`) for the nightly job. |
| `deploy.yml` → `supabase` job | review fix (replaces M3-D's `supabase-deploy.yml`) | Runs only on `push` to `main`, by hand or when called by `nightly.yml`, after CI and before the Pages build: `supabase db push --db-url "$SUPABASE_DB_URL"` and `supabase functions deploy admin-owner-link --project-ref lxcnmbcqdafhmhqimkgj --use-api`. Skips with a notice until both secrets exist. Never pushes the seed. (A `workflow_run` trigger was dropped: it also fires for fork PRs from a branch named `main`.) |
| `nightly.yml` | M5-B | 19:15 UTC (03:15 MYT) + manual: photo sync, deploy only if changed, mark published, delete staging, encrypted backup, heartbeat. |

**One-time setup (Eshan, not code):**

1. Supabase dashboard: create the publishable and secret API keys if the project has only legacy keys; Auth → enable Anonymous sign-ins; Auth → Email → OTP expiry 86400 s; Site URL `https://terasdigitalsolutions.github.io/lapar/`. Confirm the Postgres major version matches `supabase/config.toml` (`[db] major_version`).
2. GitHub repo variables: `SUPABASE_PUBLIC_KEY` (publishable key; public). Secrets: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN` (CLI deploys), `AGE_PUBLIC_KEY`, `BACKUP_REPO_TOKEN` (fine-grained, contents:write on `lapar-backups` only). Pages source: GitHub Actions. If `main` is protected, allow the Actions bot to push (nightly photo and heartbeat commits).
3. Create the private repo `TerasDigitalSolutions/lapar-backups` and an `age` key pair (keep the private key offline).
4. After the first `supabase db push`: create your admin user in the dashboard (Auth → Add user, auto-confirm), then once in the SQL editor: `insert into public.platform_admins (user_id) select id from auth.users where email = '<your email>';`. Set the WhatsApp number in `#/admin`.

## 14. Testing

| Layer | Tool | Where | What |
| --- | --- | --- | --- |
| Unit | Vitest (jsdom) | `app/src/**/*.test.ts(x)` | Every `lib/` module (cash rounding, split shares, suggestion picking, photo URL, MYT windows, promo pricing, CSV, status moves), `resolveEntitlements`, DemoData rules (approval modes, prices, moves, limits, gates, payments), key screens with Testing Library on DemoData. |
| Database | pgTAP, `supabase test db` | `supabase/tests/database/*.test.sql` | Every policy and RPC: shop isolation, table-token scope, three approval modes, server prices, item moves, plan gates and limits, PIN lockout, privileges allowlist (anon may run only the 5 customer RPCs; RLS on every table; no client grant on secret tables). Uses seed fixtures (md5 ids). |
| E2E demo | Playwright, `npm run e2e` | `e2e/demo/*.spec.ts` | Phone (390×844) and tablet (1280×800): order → approve → New → Preparing → Cooking → Ready → served → paid, customer status updates, plan switch, reset, offline after one visit, no off-origin requests. CI, no backend. |
| E2E real | Playwright, `npx playwright test -c playwright.local.config.ts` | `e2e/local/*.spec.ts` | Against `supabase start` + `vite` dev server with `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLIC_KEY` from `supabase status -o env`: the M3 flow on Kopitiam Teras, Pro flows on Restoran Contoh, admin create shop/plan/override/owner link. CI job `e2e-local`. |
| Python | `python3 -m unittest` | `scripts/test_photo_sync.py` | Naming/hash, resize, orphan detection, conditional publish. |

UI rules for every card: touch targets ≥ 48 px (`min-h-12`), no dragging anywhere, one-handed on a phone, all strings through `useT`, all storage through `lib/storage.ts`, money through `lib/money.ts`, no new npm dependencies unless a card says so.
