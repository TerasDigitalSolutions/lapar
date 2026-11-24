# Lapar data model

Postgres on Supabase. One schema (`public`), multi-tenant by `shop_id`. This is the spec the migration cards implement; `app/src/data/types.ts` is the TypeScript side of the same contract. Owners of each part are in `docs/PLAN.md`.

## 1. Conventions (all SQL cards)

| Topic | Rule |
| --- | --- |
| Money | `int` sen, `check (x >= 0)` unless stated. Never `numeric`/`float` for money. |
| Time | `timestamptz` everywhere. "Today", report days, pickup numbers, time windows and promos use `Asia/Kuala_Lumpur` (MYT) via `public.myt_today()` and `public.in_window()`. |
| Ids | `uuid primary key default gen_random_uuid()`. |
| Tenancy | Every shop-owned table has `shop_id uuid not null references shops(id) on delete cascade`; those with an `id` also have `unique (shop_id, id)`. References between shop rows are **composite FKs** `(shop_id, x_id) references x (shop_id, id)` so a row can never point into another shop (nullable references use the default MATCH SIMPLE). Global tables without `shop_id`: `entitlement_keys`, `plans`, `plan_features`, `platform_admins`, `platform_settings`. Create order follows the FKs: `tab_payments`, `board_columns` and `promos` before `order_items`; the `shops.nudge_category_id` FK after `categories`. |
| RLS | `enable row level security` on **every** table. Policies only for `authenticated`. `anon` has no table privileges at all. |
| Functions | Every function: `language plpgsql` or `sql`, `security definer`, `set search_path = ''`, and **every** object schema-qualified (`public.orders`, `extensions.crypt`, `extensions.gen_random_bytes`, `auth.uid()`). Read-only ones `stable`. |
| Privileges | Migration 0100 revokes default EXECUTE on functions and all table privileges from `public`, `anon`, `authenticated` (`alter default privileges for role postgres in schema public revoke ...`). Each migration then grants exactly what section 7 lists. |
| Errors | `raise exception '<code>' using detail = '<detail>';` where `<code>` is a `LaparErrorCode` from `types.ts` (`not_found`, `forbidden`, `feature_not_enabled`, ...). Detail carries the feature key, limit key, field or item id. Never raise free text. |
| RPC JSON | RPCs return `jsonb` whose keys are exactly the **camelCase** field names of the DTO named in section 6 (`priceSen`, `tableLabel`, ...). Arguments are `p_snake_case`. Arrays are `[]`, never null. |
| Order lines | `order_items.options` stores `LineOption[]` with camelCase keys (`groupId`, `groupName`, `optionId`, `name`, `priceDeltaSen`). |
| pgcrypto | Lives in schema `extensions` on Supabase: `extensions.crypt`, `extensions.gen_salt('bf', 8)`, `extensions.gen_random_bytes`. |

## 2. Enums

| Type | Labels |
| --- | --- |
| `approval_mode` | every_order, first_order, none |
| `tab_status` | open, closed |
| `order_status` | pending_approval, approved, rejected, cancelled (reserved, unused in v1) |
| `item_status` | pending, new, preparing, cooking, ready, served, cancelled |
| `service_reason` | bill, water, other |
| `service_status` | open, acknowledged, done |
| `photo_state` | none, staging, published |
| `paid_method` | cash, duitnow, card, other |
| `table_kind` | table, counter |
| `line_kind` | item, combo, component |
| `discount_type` | percent, amount |

## 3. Tables

`c` = `char_length`. "ts" = `timestamptz not null default now()`. All `sort` columns are `int not null default 0`. All `translations` columns are `jsonb not null default '{}'` shaped `{"ms":{"name":..,"description":..},"zh":{...}}`.

### 3.1 Plans and platform

| Table | Columns | Constraints / indexes |
| --- | --- | --- |
| `entitlement_keys` | `key text pk`, `kind text not null` | `kind in ('feature','limit')`. Rows: the 25 `FEATURE_KEYS` and 4 `LIMIT_KEYS` of `keys.ts`. |
| `plans` | `id text pk`, `name text not null` | `id in ('basic','pro')`. Rows: basic "Lapar Basic", pro "Lapar Pro". |
| `plan_features` | `plan_id text fk plans`, `feature_key text fk entitlement_keys`, `enabled boolean not null default true`, `limit_value int null` | pk `(plan_id, feature_key)`; `limit_value >= 0`. Rows: **every key for both plans** (58 rows) = `PLAN_DEFAULTS`. Limit rows: basic 15/1/3/30, pro null (unlimited). |
| `platform_admins` | `user_id uuid pk fk auth.users on delete cascade`, `created_at` ts | |
| `platform_settings` | `id boolean pk default true`, `whatsapp_number text null`, `updated_at` ts, `updated_by uuid null fk auth.users on delete set null` | `check (id)` (single row); `whatsapp_number ~ '^[0-9]{8,15}$'`. One row inserted by the migration with null number. |

### 3.2 Shops and people

| Table | Columns | Constraints / indexes |
| --- | --- | --- |
| `shops` | `id`, `name text`, `slug text`, `logo_url text null`, `plan_id text not null default 'basic' fk plans`, `approval_mode approval_mode not null default 'first_order'`, `nudge_category_id uuid null`, `active boolean not null default true`, `pickup_board_token text null`, `created_at` ts | `c(name) 1..80`; `slug unique`, `slug ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$'`; `logo_url ~ '^https?://'`; `pickup_board_token unique`, `c >= 22`; FK `(id, nudge_category_id) references categories (shop_id, id) on delete set null (nudge_category_id)` (added after `categories`). |
| `shop_owners` | `shop_id`, `user_id uuid fk auth.users on delete cascade`, `created_at` ts | pk `(shop_id, user_id)`; index `(user_id)`. |
| `shop_feature_overrides` | `shop_id`, `feature_key text fk entitlement_keys`, `enabled boolean null`, `limit_value int null`, `note text not null`, `changed_by uuid null fk auth.users on delete set null`, `changed_at` ts | pk `(shop_id, feature_key)`; `limit_value >= 0`; `c(note) 1..200`. Feature keys use `enabled` (not null, enforced by `admin_set_override`); limit keys use `limit_value` (null = unlimited). |
| `staff` | `id`, `shop_id`, `name text`, `active boolean not null default true`, `created_at` ts | `c(name) 1..40`; index `(shop_id)`. No PIN here. |
| `staff_pins` | `staff_id uuid pk`, `shop_id`, `pin_hash text not null`, `updated_at` ts | FK `(shop_id, staff_id) → staff on delete cascade`. **No grants to any client role.** bcrypt via `extensions.crypt(pin, extensions.gen_salt('bf', 8))`. |
| `staff_sessions` | `auth_uid uuid pk fk auth.users on delete cascade`, `shop_id`, `staff_id uuid not null`, `created_at` ts, `expires_at timestamptz not null` | FK `(shop_id, staff_id) → staff on delete cascade`; index `(shop_id)`, `(staff_id)`. One session per device user. No client grants. |
| `pin_attempts` | `shop_id uuid pk`, `failures int not null default 0`, `locked_until timestamptz null`, `updated_at` ts | No client grants. |

### 3.3 Menu

| Table | Columns | Constraints / indexes |
| --- | --- | --- |
| `stations` | `id`, `shop_id`, `name text`, `sort`, `active boolean not null default true`, `created_at` ts | `c(name) 1..30`; index `(shop_id, sort)`. Basic: exactly one ("Kitchen"). |
| `categories` | `id`, `shop_id`, `name text`, `translations`, `sort`, `available_from time null`, `available_to time null`, `available_days smallint[] null`, `created_at` ts | `c(name) 1..40`; `(available_from is null) = (available_to is null)`; `available_from <> available_to`; `available_days <@ '{1,2,3,4,5,6,7}'` and non-empty when set. Window is used only with `timed_menus`. |
| `items` | `id`, `shop_id`, `category_id uuid not null`, `station_id uuid not null`, `name text`, `description text not null default ''`, `translations`, `price_sen int not null`, `photo_url text null`, `photo_state photo_state not null default 'none'`, `active boolean not null default true`, `sold_out boolean not null default false`, `is_combo boolean not null default false`, `sort`, `created_at` ts, `updated_at` ts | `c(name) 1..60`; `c(description) <= 300`; `price_sen between 0 and 10000000`; FK `(shop_id, category_id) → categories` (restrict); FK `(shop_id, station_id) → stations`; `(photo_state = 'none') = (photo_url is null)`; `photo_state <> 'published' or photo_url like 'menu/%'`; `photo_state <> 'staging' or photo_url ~ '^https?://'`; index `(shop_id, category_id, sort)`. Never deleted (deactivate). |
| `modifier_groups` | `id`, `shop_id`, `item_id`, `name text`, `translations`, `min_select smallint not null default 0`, `max_select smallint not null default 1`, `sort` | `c(name) 1..40`; `min_select >= 0`; `max_select >= 1 and max_select >= min_select`; FK `(shop_id, item_id) → items on delete cascade`. |
| `modifier_options` | `id`, `shop_id`, `group_id`, `name text`, `translations`, `price_delta_sen int not null default 0`, `sort` | `c(name) 1..40`; `price_delta_sen between 0 and 1000000`; FK `(shop_id, group_id) → modifier_groups on delete cascade`. |
| `item_pairings` | `shop_id`, `source_item_id`, `suggested_item_id`, `position smallint` | pk `(source_item_id, position)`; `position between 1 and 3`; unique `(source_item_id, suggested_item_id)`; `source_item_id <> suggested_item_id`; both FKs composite → items on delete cascade. |
| `auto_pairings` | `shop_id`, `source_item_id`, `suggested_item_id`, `position smallint`, `support int not null`, `confidence real not null`, `computed_at` ts | Same keys/FKs as `item_pairings`. Written only by `refresh_auto_pairings()`. |
| `combo_components` | `shop_id`, `combo_item_id`, `item_id`, `qty smallint not null`, `sort` | pk `(combo_item_id, item_id)`; `qty between 1 and 10`; `combo_item_id <> item_id`; FKs composite → items on delete cascade. |
| `promos` | `id`, `shop_id`, `name text`, `translations`, `discount_type discount_type not null`, `discount_value int not null`, `days smallint[] not null default '{1,2,3,4,5,6,7}'`, `start_time time not null`, `end_time time not null`, `active boolean not null default true`, `created_at` ts | `c(name) 1..40`; `discount_value > 0`; `discount_type <> 'percent' or discount_value <= 100`; `days <@ '{1,...,7}'` and non-empty; `start_time <> end_time`. |
| `promo_items` | `shop_id`, `promo_id`, `item_id` | pk `(promo_id, item_id)`; FKs composite, cascade. |

### 3.4 Service

| Table | Columns | Constraints / indexes |
| --- | --- | --- |
| `tables` | `id`, `shop_id`, `label text`, `kind table_kind not null default 'table'`, `token text not null default public.new_token()`, `active boolean not null default true`, `sort`, `created_at` ts | `c(label) 1..20`; **unique `(token)`**; `c(token) >= 22`; unique index `(shop_id, lower(label)) where active`. Never deleted. |
| `tabs` | `id`, `shop_id`, `table_id`, `kind table_kind not null`, `status tab_status not null default 'open'`, `opened_at` ts, `closed_at timestamptz null`, `pickup_no int null`, `pickup_at timestamptz null`, `paid_total_sen int null`, `rounding_sen int null`, `updated_at` ts | FK `(shop_id, table_id) → tables`; `(status = 'closed') = (closed_at is not null)`; `kind = 'counter' or (pickup_no is null and pickup_at is null)`; `paid_total_sen >= 0`; **unique index `(table_id) where status = 'open' and kind = 'table'`** (one open tab per table); index `(shop_id, status)`, `(table_id, status)`. `kind` copies the table's kind. |
| `orders` | `id`, `shop_id`, `tab_id`, `status order_status not null`, `created_at` ts, `approved_at timestamptz null`, `approved_by_staff_id uuid null`, `rejected_reason text null` | FK `(shop_id, tab_id) → tabs`; FK `(shop_id, approved_by_staff_id) → staff`; `c(rejected_reason) <= 140`; **index `(shop_id, status)`**; index `(tab_id)`, `(shop_id, created_at)`. |
| `order_items` | `id`, `shop_id`, `order_id`, `line_no smallint not null`, `kind line_kind not null default 'item'`, `parent_line_id uuid null`, `item_id uuid not null`, `name_snapshot text not null`, `list_price_sen int not null`, `unit_price_sen int not null`, `promo_id uuid null`, `qty smallint not null`, `options jsonb not null default '[]'`, `options_price_sen int not null default 0`, `line_total_sen int generated always as (qty * (unit_price_sen + options_price_sen)) stored`, `note text null`, `station_id uuid not null`, `status item_status not null`, `status_changed_at` ts, `column_id uuid null`, `ready_at timestamptz null`, `served_at timestamptz null`, `suggested_from_item_id uuid null`, `paid_payment_id uuid null`, `created_at` ts | FKs composite: order, item, station, `parent_line_id → order_items`, `promo_id → promos on delete set null (promo_id)`, `column_id → board_columns on delete set null (column_id)`, `suggested_from_item_id → items`, `paid_payment_id → tab_payments`; unique `(order_id, line_no)`; `qty between 1 and 999`; `c(note) <= 140`; prices `>= 0`; **index `(shop_id, status)`**; index `(order_id)`, `(shop_id, station_id, status)`, `(suggested_from_item_id) where suggested_from_item_id is not null`. |
| `service_requests` | `id`, `shop_id`, `table_id`, `tab_id uuid null`, `reason service_reason not null`, `note text null`, `status service_status not null default 'open'`, `tap_count int not null default 1`, `created_at` ts, `updated_at` ts, `acknowledged_at timestamptz null`, `done_at timestamptz null` | FKs composite tables, tabs; `c(note) <= 140`; **unique index `(table_id, reason) where status <> 'done'`** (merge target); index `(shop_id, status)`. |
| `tab_payments` | `id`, `shop_id`, `tab_id`, `method paid_method not null`, `amount_sen int not null`, `rounding_sen int not null default 0`, `created_at` ts, `created_by_staff_id uuid null` | FKs composite tabs, staff; `amount_sen > 0`; `rounding_sen between -2 and 2`; index `(tab_id)`, `(shop_id, created_at)`. Every plan records payments here (Basic: one per tab). |
| `board_columns` | `id`, `shop_id`, `station_id`, `name text`, `core_status item_status not null`, `sort int not null` | FK `(shop_id, station_id) → stations on delete cascade`; `c(name) 1..24`; `core_status in ('new','preparing','cooking','ready')`. Written only by `set_board_columns`. |
| `pickup_counters` | `shop_id`, `day date`, `last_no int not null` | pk `(shop_id, day)`. No client grants. |

## 4. Triggers (migration 0200)

| Trigger | On | Rule |
| --- | --- | --- |
| `items_set_defaults` | before insert on `items` | `station_id := coalesce(new.station_id, public.default_station(new.shop_id))`. |
| `touch_updated_at` | before update on `items`, `service_requests`, `tabs` | `new.updated_at := now()`. |
| `enforce_limits` | before insert or update of `active` on `tables`, `stations`, `staff` | When the row becomes active (insert, or false → true): take `pg_advisory_xact_lock(hashtext('limits:' \|\| shop_id))`, count other active rows (tables: `kind = 'table'` only; counters never count), raise `limit_reached` (detail `max_tables` / `max_stations` / `max_staff`) unless `within_limit()`. Existing over-limit rows after a downgrade keep working. |
| `counter_needs_takeaway` | before insert on `tables` | `kind = 'counter'` and not `has_feature(shop_id,'takeaway')` → `feature_not_enabled` `takeaway`. |
| `combo_needs_feature` | before insert or update of `is_combo` on `items` | `is_combo` and not `has_feature(shop_id,'combos')` → `feature_not_enabled` `combos`. |
| `keep_one_station` | before update of `active` on `stations` | Deactivating the shop's last active station → `invalid_input` `last_station`. |
| `auto_pairings_on_gain` (0500) | after insert/update on `shop_feature_overrides`, after update of `plan_id` on `shops` | If the shop now has `auto_pairings`, `perform public.refresh_auto_pairings(shop_id)`. |

## 5. Helper functions

Granted to `authenticated` only where marked (RLS policies call them as the user). The rest have no client grants.

| Function | Returns | Mig. | Grant | Rule |
| --- | --- | --- | --- | --- |
| `new_token()` | text | 0100 | authenticated | 18 bytes `extensions.gen_random_bytes`, base64url without padding (24 chars). Column default of `tables.token`. |
| `try_uuid(p text)` | uuid | 0100 | authenticated | Null instead of a cast error. Used by storage policy. `immutable`. |
| `myt_today()` | date | 0100 | | `(now() at time zone 'Asia/Kuala_Lumpur')::date`. |
| `in_window(p_from time, p_to time, p_days smallint[], p_at timestamptz)` | boolean | 0100 | | Local = `p_at` in MYT. False if `p_days` set and `isodow` not in it. `p_from < p_to`: `from <= t < to`; else (wraps midnight): `t >= from or t < to`. |
| `round_cash(p_sen int)` | int | 0100 | | Nearest 5 sen: remainder 1–2 down, 3–4 up (1233 → 1235, 1232 → 1230). `immutable`. |
| `current_shop_ids()` | setof uuid | 0200 | authenticated | Shops where `auth.uid()` is in `shop_owners`, union shops of a `staff_sessions` row with `expires_at > now()` whose staff is active. |
| `is_member(p_shop uuid)` | boolean | 0200 | authenticated | `p_shop in current_shop_ids()`. |
| `is_owner(p_shop uuid)` | boolean | 0200 | authenticated | Row in `shop_owners` for `auth.uid()`. |
| `is_platform_admin()` | boolean | 0200 | authenticated (also an RPC) | Row in `platform_admins` for `auth.uid()`. |
| `current_staff_id(p_shop uuid)` | uuid | 0200 | | Live staff session's `staff_id` for this shop, else null (owner). |
| `get_entitlements(p_shop_id uuid)` | jsonb | 0200 | authenticated (an RPC) | Caller must be a member or platform admin, else `forbidden`; returns `entitlements_of`. |
| `entitlements_of(p_shop uuid)` | jsonb | 0200 | | `{"features":{key:bool},"limits":{key:int\|null}}`: every `entitlement_keys` row; value = override if a row exists, else `plan_features` for the shop's plan (missing feature row = false). No caller check. |
| `has_feature(p_shop uuid, p_key text)` | boolean | 0200 | authenticated | From `entitlements_of`. |
| `limit_of(p_shop uuid, p_key text)` | int | 0200 | | Null = unlimited. |
| `within_limit(p_shop uuid, p_key text, p_count bigint)` | boolean | 0200 | | `limit_of is null or p_count < limit_of`. |
| `default_station(p_shop uuid)` | uuid | 0200 | | First active station by `sort, created_at`. |
| `assert_member(p_shop)`, `assert_owner(p_shop)`, `assert_admin()`, `assert_feature(p_shop, p_key)` | void | 0200 | | Raise `not_signed_in` (no `auth.uid()`), `forbidden`, or `feature_not_enabled`. First line of every RPC. |
| `next_pickup_no(p_shop uuid)` | int | 0300 | | `insert into pickup_counters values (p_shop, myt_today(), 1) on conflict do update set last_no = last_no + 1 returning last_no`. |
| `tab_money(p_tab uuid)` | record `(total_sen, pending_sen, paid_sen, rounding_sen)` | 0300 | | Total = `line_total_sen` of lines with order `approved`, status not `cancelled`, kind not `component`. Pending = same for `pending_approval` orders. Paid/rounding = sums over `tab_payments`. |
| `assert_report_window(p_shop uuid, p_day date)` | void | 0500 | | `report_history_days` N not null and `p_day < myt_today() - (N - 1)` → `outside_report_window`. |

## 6. RPCs

Every RPC: `security definer`, `set search_path = ''`, first line a caller check. "Gate" = `assert_feature`. Returns name the DTO in `types.ts`.

### 6.1 Customer (`anon`, `authenticated`) — migration 0300

| Signature | Returns | Checks and behaviour |
| --- | --- | --- |
| `get_menu(p_table_token text)` | `MenuDTO` | Active table by token else `not_found`. Inactive shop: `shop.active=false` with empty categories/items. Features from `entitlements_of`. Categories sorted (`sort, name`). Items: active, combos only if `combos`. `translations` = `{}` unless `multi_language_menu`. `window`/`availableNow` only with `timed_menus` (else null/true). Promo (with `promos`): among active promos listing the item and `in_window(now())`, the lowest price wins; `effectivePriceSen` = that price; `endsAt` = today's MYT end time (next day if the window wraps). Suggestions: manual (`manual_pairings`) by position, then auto (`auto_pairings`) by position, no duplicates, only active items. `combo` with components when `combos`. `nudgeCategoryId` null unless `checkout_nudge`. |
| `place_order(p_table_token text, p_lines jsonb, p_pickup_at timestamptz default null)` | `PlaceOrderResult` | See 6.1.1. |
| `get_tab(p_table_token text, p_tab_id uuid default null)` | `CustomerTabDTO` | Active table else `not_found`. Table: its open tab (ignore `p_tab_id`). Counter: `p_tab_id` required (`invalid_input`), tab must belong to this counter and be opened in the last 24 h (`not_found`); closed tabs are returned too. Money from `tab_money`. Orders oldest first, lines by `line_no`. `openRequests`: not-done calls for this table. |
| `call_server(p_table_token text, p_reason service_reason, p_note text default null)` | `{requestId, tapCount}` | Active table (`not_found`), active shop (`shop_inactive`), gate `call_server`. Note trimmed, empty → null, `<= 140` (`invalid_input`). `insert ... on conflict (table_id, reason) where status <> 'done' do update set tap_count = tap_count + 1, note = coalesce(excluded.note, note), status = 'open', updated_at = now()` (a repeat tap re-opens an acknowledged call). New rows link the open tab. |
| `get_pickup_board(p_board_token text)` | `PickupBoardDTO` | Shop by `pickup_board_token` (`not_found`), gate `takeaway`. Today's (MYT) open counter tabs with at least one approved order. Board lines = kinds item/component, not cancelled, of approved orders. `ready`: all lines ready or served and at least one ready. `preparing`: any line new/preparing/cooking. Tabs whose lines are all served are left out. Numbers ascending. |

#### 6.1.1 `place_order`

1. `select ... from tables where token = p_table_token and active for update` (serialises orders per table) else `not_found`. Shop inactive → `shop_inactive`. `f` = features. Gate `qr_ordering`.
2. Counter table without `takeaway` → `feature_not_enabled takeaway`. `p_pickup_at` on a table → `invalid_input pickup_at`; on a counter it must be `>= now() - 1 minute` and on today's MYT date.
3. `p_lines` must be a JSON array of 1..30 → `invalid_input lines`.
4. Rate limit: orders on tabs of this table in the last 5 minutes `>= 5` (counter: `>= 20`) → `rate_limited`.
5. Each line `{itemId, qty, optionIds, note, suggestedFromItemId}`: uuid/int parsing failures → `invalid_input <field>`; `qty 1..99`; note trimmed `<= 140`; `optionIds` distinct; `suggestedFromItemId` null or an item of this shop. Item must be this shop's and active (`item_unavailable` detail id), not sold out (`sold_out` detail id). Combo item: gate `combos`; options not allowed. With `timed_menus`, a category window that is not `in_window(now())` → `item_unavailable`. Options: non-empty needs `modifiers`; every option must belong to a group of this item; each group's chosen count within `[min_select, max_select]` (also enforces required groups) → `invalid_input option_ids`.
6. Price on the server only: `list = items.price_sen`; with `promos` the best active promo: percent → `(list * (100 - v) + 50) / 100`, amount → `greatest(list - v, 0)`; `options_price` = sum of chosen deltas; snapshot options as `LineOption[]`.
7. Station: with `multi_station` the item's station if active, else `default_station(shop)`.
8. Tab: table → existing open tab `for update`, else insert (kind table). Counter → always a new tab with `pickup_no = next_pickup_no(shop)` and `pickup_at`.
9. Approval: mode = shop's, `none` when `approvals` is off. Needs approval if `every_order`, or `first_order` and the tab has no approved order yet. Order `pending_approval` (lines `pending`) or `approved` with `approved_at = now()` (lines `new`).
10. Lines get `line_no` 1..n in input order. A combo line (kind `combo`, its price, `default_station`) is followed by one component line per `combo_components` row: kind `component`, item = component, prices 0, `qty = parent qty * component qty`, note copied, station routed as in step 7, `parent_line_id` set.
11. Touch `tabs.updated_at`. Return the order with every line priced.

### 6.2 Staff and owner sessions (`authenticated`) — migration 0400

| Signature | Returns | Checks and behaviour |
| --- | --- | --- |
| `claim_staff_session(p_shop_slug text, p_pin text)` | `{ok, error?, lockedUntil?, session?}` | No `auth.uid()` → raise `not_signed_in`. Unknown slug → raise `not_found`. Gate `staff_pins`. Lock the shop's `pin_attempts` row (insert if missing). If `locked_until > now()` return `{ok:false, error:'pin_locked', lockedUntil}`; an expired lock resets `failures`. PIN not `^[0-9]{4,6}$` counts as wrong. Match = active staff whose `pin_hash = extensions.crypt(p_pin, pin_hash)`. Wrong: `failures + 1`; at 5 set `locked_until = now() + 10 min`, `failures = 0`; **return** `{ok:false, error:'invalid_pin' or 'pin_locked'}` — never raise here, or the counter rolls back. Right: `failures = 0`, upsert `staff_sessions` (`expires_at = now() + 16 h`), return `{ok:true, session: StaffSession}`. |
| `my_staff_session()` | `StaffSession` or null | Live session of `auth.uid()` with active staff. |
| `end_staff_session()` | void | Deletes the caller's session row. |
| `my_shops()` | `OwnerShopDTO[]` | Shops the caller owns. |
| `is_platform_admin()` | boolean | (0200.) |

### 6.3 Staff (staff session or owner: `assert_member`) — migration 0400

| Signature | Returns | Checks and behaviour |
| --- | --- | --- |
| `get_pending_orders(p_shop_id uuid)` | `PendingOrderDTO[]` | `pending_approval`, oldest first, lines by `line_no`. |
| `approve_order(p_order_id uuid)` | void | Unknown → `not_found`; member of its shop; status must be `pending_approval` (`invalid_transition`); tab open (`tab_closed`). Sets `approved`, `approved_at`, `approved_by_staff_id = current_staff_id()`; lines `pending → new`, `status_changed_at = now()`. |
| `reject_order(p_order_id uuid, p_reason text)` | void | Reason trimmed 1..140 (`invalid_input`); pending only. Sets `rejected`, `rejected_reason`; lines → `cancelled`. |
| `get_service_requests(p_shop_id uuid)` | `ServiceRequestDTO[]` | Status open/acknowledged, oldest first. |
| `acknowledge_request(p_request_id uuid)` | void | open → acknowledged (`acknowledged_at`); already acknowledged = no-op; done → `invalid_transition`. |
| `complete_request(p_request_id uuid)` | void | → done (`done_at`). |
| `get_stations(p_shop_id uuid)` | `StationRow[]` | Active, by sort. |
| `get_board(p_shop_id uuid, p_station_id uuid default null)` | `BoardDTO` | Station = given (must be this shop's, `not_found`) or `default_station`. Columns: with `custom_columns` and rows for the station, those rows by sort; else four fixed `{id:null, name:null, coreStatus, sort 0..3}`. Lines: approved orders, kind item/component, status new..ready, this station; `position`/`positionOf` over the order's non-cancelled item/component lines by `line_no`; `parentName` from the combo line; oldest `approved_at` first. |
| `advance_item(p_item_id uuid, p_to item_status, p_column_id uuid default null)` | void | Line `for update` (`not_found`), member, order `approved`, kind not `combo` (`invalid_transition`). Allowed moves: new→preparing, preparing→cooking, cooking→ready, ready→served (forward); preparing→new, cooking→preparing, ready→cooking (back); new/preparing/cooking/ready→cancelled. Same status is allowed only with a column. `p_column_id`: gate `custom_columns`; column of the same shop and station and `core_status = p_to` (`invalid_input column_id`). Sets `status`, `column_id` (null when not given), `status_changed_at`, `ready_at` on ready, `served_at` on served. |
| `get_ready_lines(p_shop_id uuid)` | `BoardLineDTO[]` | Status ready, all stations, oldest `status_changed_at` first. |
| `get_tables_overview(p_shop_id uuid)` | `TableOverviewDTO[]` | Active tables then counters (sort, label); open tabs with `tab_money` sums, pending order and ready line counts; open request count. |
| `get_tab_detail(p_tab_id uuid)` | `TabDetailDTO` | Member of the tab's shop. |
| `record_payment(p_tab_id uuid, p_method paid_method, p_amount_sen int default null, p_order_item_ids uuid[] default null)` | `RecordPaymentResult` | Tab `for update`, member, open (`tab_closed`), gate `manual_payments`, no pending orders (`pending_orders`). By item (`p_order_item_ids` non-empty): gate `bill_split`; rejected if the tab already has an amount-only payment (`invalid_input mixed_split`); lines must be this tab's, kind item/combo, approved, not cancelled, unpaid (`invalid_input order_item_ids`); amount = their totals. Amount: `1..remaining` (`invalid_input amount`), less than remaining needs `bill_split`. Neither: amount = remaining. Remaining 0: close without a payment row. Cash: `rounding = round_cash(amount) - amount`, else 0. Insert payment (`created_by_staff_id`), mark item-split lines `paid_payment_id`. When paid reaches total: `status closed`, `closed_at`, `paid_total_sen = sum(amount)`, `rounding_sen = sum(rounding)`. Always touch `tabs.updated_at` (Realtime). |
| `get_sold_out_items(p_shop_id uuid)` | `SoldOutItemDTO[]` | Active items by category sort, item sort. |
| `set_item_sold_out(p_item_id uuid, p_sold_out boolean)` | void | Member of the item's shop. |

### 6.4 Owner (`assert_owner`) — migration 0500

| Signature | Returns | Checks and behaviour |
| --- | --- | --- |
| `get_menu_editor(p_shop_id uuid)` | `MenuEditorDTO` | All categories (with `window` object), items (active and inactive), groups, options, pairings, combo components, stations; sorted. |
| `add_staff(p_shop_id uuid, p_name text, p_pin text)` | `StaffRow` | Gate `staff_pins`. Name 1..40, PIN `^[0-9]{4,6}$` (`invalid_input`). PIN equal to an active colleague's (`crypt` compare) → `duplicate_pin`. Insert staff (limit trigger) and `staff_pins`. |
| `update_staff(p_staff_id uuid, p_name text default null, p_active boolean default null)` | void | Reactivation runs the limit trigger and the duplicate PIN check. Deactivation deletes the person's `staff_sessions`. |
| `set_staff_pin(p_staff_id uuid, p_pin text)` | void | Same PIN rules (excluding self). |
| `regenerate_table_token(p_table_id uuid)` | `TableRow` | `token = new_token()`; the old QR stops working. |
| `set_item_pairings(p_item_id uuid, p_suggested uuid[])` | void | Gate `manual_pairings`. At most 3, distinct, not the item itself, this shop's items (`invalid_input`). Replaces rows, positions 1..n. |
| `get_daily_summary(p_shop_id uuid, p_day date)` | `DailySummaryDTO` | Gate `daily_summary`; `p_day <= myt_today()`; `assert_report_window`. Sales = approved, not cancelled, kind item/combo lines of orders created that MYT day; bills = distinct tabs among them; average = half-up `sales / bills`; top 5 by qty, then revenue. |
| `get_shop_plan(p_shop_id uuid)` | `ShopPlanDTO` | Entitlements, usage counts (active tables of kind table, active stations, active staff), `askTerasWhatsapp` from `platform_settings`. |

### 6.5 Pro owner (`assert_owner` + gate) — migration 0500

| Signature | Gate | Returns | Behaviour |
| --- | --- | --- | --- |
| `set_board_columns(p_station_id uuid, p_columns jsonb)` | custom_columns | `BoardColumnRow[]` | 4..12 columns, names 1..24; core statuses non-decreasing along the list and each of new/preparing/cooking/ready present (`invalid_input columns`). Given ids must be this station's. Update kept ids, insert new, delete the rest (lines fall back to the first column of their status). `sort` = list index. |
| `save_promo(p_promo jsonb)` | promos | `PromoRow` | Upsert a `PromoInput`; items must be this shop's; replaces `promo_items`. |
| `set_combo_components(p_combo_item_id uuid, p_components jsonb)` | combos | void | Item must be `is_combo`; 1..6 components, distinct, not combos, this shop's, qty 1..10. Replaces rows. |
| `regenerate_pickup_board_token(p_shop_id uuid)` | takeaway | text | New `new_token()`. |
| `get_sales_report(p_shop_id uuid, p_from date, p_to date)` | full_reports | `SalesReportDTO` | `p_from <= p_to`, span <= 366 days, `assert_report_window(p_from)`. Same sales rules as the daily summary. `byHour` = 24 rows. `items` = every active item, zero sellers included, revenue desc. Prep minutes = `ready_at - orders.approved_at` for item/component lines with `ready_at` in range; avg and median (`percentile_cont(0.5)`), rounded to 1 decimal. |
| `get_upsell_report(p_shop_id uuid, p_month date)` | upsell_report | `UpsellReportDTO` | Month containing `p_month` (MYT), clamped by the report window. Lines with `suggested_from_item_id` (approved, not cancelled): grouped by (source, suggested): adds, revenue; `sourceOrders` = orders that month containing the source item. |
| `export_shop_meta(p_shop_id uuid)` | export_backup | `ShopExportMeta` | Never includes PIN hashes or sessions. |
| `export_orders(p_shop_id uuid, p_from date, p_to date)` | export_backup | `OrdersExportDTO` | Span <= 93 days. Orders created in range with lines; payments created in range. Not limited by the report window (it is a backup). |
| `refresh_auto_pairings(p_shop_id uuid default null)` | — | void | **No client grant** (cron, triggers, seed). For each shop with `auto_pairings` (or the given one): last 90 days of approved orders, item/combo lines not cancelled, active items; pairs (a, b) in the same order with support = distinct orders >= 3; confidence = support / orders containing a; top 3 per source by confidence, support. Replaces that shop's `auto_pairings`. |

### 6.6 Teras admin (`assert_admin`) — migration 0600

| Signature | Returns | Behaviour |
| --- | --- | --- |
| `admin_list_shops()` | `AdminShopDTO[]` | All shops with plan, active, created, `lastOrderAt = max(orders.created_at)`, owner emails (`auth.users`), overrides (with changer's email), resolved entitlements. |
| `admin_create_shop(p_name text, p_slug text)` | uuid | Slug format (`invalid_input slug`), unique (`slug_taken`). Inserts the shop (basic), station "Kitchen", category "Drinks", sets `nudge_category_id`. |
| `admin_set_plan(p_shop_id uuid, p_plan_id text)` | void | `plan_id in plans`. Data is never deleted on downgrade. |
| `admin_set_override(p_shop_id uuid, p_key text, p_enabled boolean, p_limit_value int, p_note text)` | void | Key must exist; feature key needs `p_enabled` not null; limit key stores `p_limit_value` (null = unlimited); note 1..200. Upsert with `changed_by = auth.uid()`, `changed_at = now()`. |
| `admin_clear_override(p_shop_id uuid, p_key text)` | void | Deletes the row. |
| `admin_set_shop_active(p_shop_id uuid, p_active boolean)` | void | Inactive: customers see "Not taking orders"; staff can still settle tabs. |
| `admin_get_platform_settings()` | `PlatformSettingsDTO` | |
| `admin_set_platform_settings(p_whatsapp_number text)` | void | Digits only after stripping spaces, `+` and `-`; empty → null; else `^[0-9]{8,15}$` (`invalid_input`). Sets `updated_by`. |

### 6.7 Edge Function `admin-owner-link` — `supabase/functions/admin-owner-link/index.ts`

| Item | Rule |
| --- | --- |
| Call | `POST {shopId, email, mode: 'invite' or 'reset'}` with the admin's session (supabase-js `functions.invoke`). Handles `OPTIONS` (CORS: `*`, headers `authorization, x-client-info, apikey, content-type`). |
| Config | `[functions.admin-owner-link] verify_jwt = false` in `supabase/config.toml` (new keys are not JWTs); the function authorises itself. |
| Secret key | `JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`. Never returned or logged. |
| Caller check | `Authorization: Bearer <user JWT>` → `admin.auth.getUser(jwt)`; must have a `platform_admins` row → else 403 `{error:'forbidden'}`. |
| invite | Email lower-cased and checked; shop must exist (404 `not_found`). `auth.admin.createUser({email, email_confirm: true})` (ignore `email_exists`), then `auth.admin.generateLink({type:'magiclink', email})`; upsert `shop_owners(shopId, data.user.id)`. |
| reset | `generateLink({type:'recovery', email})`; the user must already own `shopId` (else 404). |
| Response | `{email, mode, tokenHash: properties.hashed_token, verifyType: 'email' or 'recovery'}`. The browser builds `${SITE_BASE_URL}#/welcome?token_hash=...&type=...` (`OwnerLinkDTO`) and offers copy and `https://wa.me/?text=...`. `#/welcome` calls `auth.verifyOtp({token_hash, type})`. No email is ever sent. |

## 7. Privileges and RLS

### 7.1 Function grants

| Role | Functions |
| --- | --- |
| `anon` | `get_menu`, `place_order`, `get_tab`, `call_server`, `get_pickup_board`. Nothing else (pgTAP asserts the allowlist). |
| `authenticated` | The five customer RPCs; every RPC in 6.2–6.6; helpers `new_token`, `try_uuid`, `current_shop_ids`, `is_member`, `is_owner`, `is_platform_admin`, `has_feature`, `get_entitlements(p_shop_id uuid)` (member or admin, else `forbidden`). |
| none | `entitlements_of`, `limit_of`, `within_limit`, `default_station`, `current_staff_id`, `assert_*`, `next_pickup_no`, `tab_money`, `assert_report_window`, `refresh_auto_pairings`, trigger functions, `myt_today`, `in_window`, `round_cash`. |

### 7.2 Table grants and policies (`authenticated`; `anon` has none)

"member" = `shop_id in (select public.current_shop_ids())`; "owner" = `public.is_owner(shop_id)`. Owner write policies use the same expression in `using` and `with check`.

| Table | select | insert | update | delete |
| --- | --- | --- | --- | --- |
| entitlement_keys, plans, plan_features | all | — | — | — |
| platform_admins | `user_id = auth.uid()` | — | — | — |
| platform_settings, staff_pins, staff_sessions, pin_attempts, pickup_counters | no grant | — | — | — |
| shops | `id in current_shop_ids()` | — | owner (`is_owner(id)`), columns `name, logo_url, approval_mode, nudge_category_id` only | — |
| shop_owners | own rows or member | — | — | — |
| shop_feature_overrides | owner | — | — | — |
| staff | member | — (RPC) | — (RPC) | — |
| stations | member | owner | owner | — |
| categories | member | owner | owner | owner (FK blocks non-empty → SupabaseData maps to `in_use`) |
| items | member | owner | owner | — |
| modifier_groups, modifier_options | member | owner | owner | owner |
| item_pairings, auto_pairings, combo_components, promo_items, board_columns | member | — (RPC) | — | — |
| promos | member | — (RPC `save_promo`) | — | owner |
| tables | member | owner, columns `shop_id, label, kind, sort, active` | owner, columns `label, sort, active` | — |
| tabs, orders, order_items, service_requests, tab_payments | member | — (RPC) | — | — |

Platform admins read everything through `admin_*` RPCs, not policies.

## 8. Realtime

`alter publication supabase_realtime add table public.orders, public.order_items, public.service_requests, public.tabs;` Clients subscribe with filter `shop_id=eq.<id>`; RLS decides delivery. Payloads are only a signal to reload (section "Realtime" in ARCHITECTURE.md).

## 9. Storage

| Item | Rule |
| --- | --- |
| Bucket | `menu-staging`, public, `file_size_limit` 2 MB, `allowed_mime_types` `image/webp`, `image/jpeg`. Created in migration 0200 (`insert into storage.buckets ... on conflict do nothing`). |
| Paths | Item photos `{shop_id}/{item_id}/{uuid}.webp`; logos `{shop_id}/logo/{uuid}.webp` (logos stay in Storage). |
| Policy | `insert` for `authenticated` with `bucket_id = 'menu-staging' and public.is_owner(public.try_uuid((storage.foldername(name))[1]))`. No update/delete policies: the nightly job uses the secret key. Reads use public URLs. |

## 10. Scheduled job (migration 0500)

`create extension if not exists pg_cron with schema pg_catalog;` then `select cron.schedule('lapar-nightly', '30 19 * * *', $$select public.refresh_auto_pairings(); delete from public.staff_sessions where expires_at < now() - interval '1 day';$$);` (03:30 MYT). If `pg_cron` cannot be created on the hosted project, log it in DECISIONS.md and call the same SQL from the nightly workflow instead.

## 11. Seed (`supabase/seed.sql`, local and CI only — `supabase db push` never runs it)

Ids are deterministic: `md5('<kind>:<shop>:<slug>')::uuid`, e.g. `md5('shop:a')::uuid`, `md5('item:a:teh-tarik')::uuid`, `md5('group:a:teh-tarik:temp')::uuid`, `md5('option:a:teh-tarik:ais')::uuid`, `md5('table:a:03')::uuid`, `md5('staff:a:aminah')::uuid`, `md5('user:owner-a')::uuid`. Tests derive ids the same way.

**Users** (`auth.users` + `auth.identities`, password `lapar-local-only`, `email_confirmed_at = now()`, `aud`/`role` `authenticated`, `instance_id` all zeros, and the token columns `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`, `email_change_token_current`, `phone_change`, `phone_change_token`, `reauthentication_token` set to `''` or GoTrue cannot sign them in):

| Key | Email | Role |
| --- | --- | --- |
| `user:admin` | admin@lapar.test | `platform_admins` |
| `user:owner-a` | owner-a@lapar.test | owner of shop A |
| `user:owner-b` | owner-b@lapar.test | owner of shop B |
| `user:outsider` | outsider@lapar.test | signed in, no shop |
| `user:device-a`, `user:device-b` | — (`is_anonymous = true`) | staff devices for tests (sessions are inserted by tests) |

**Shop A — "Kopitiam Teras"** (`shop:a`, slug `kopitiam-teras`, plan basic, `first_order`): station Kitchen; categories Drinks (nudge), Breakfast, Rice, Noodles, Sides; 10 tables "Table 1".."Table 10" with tokens `lapar-local-a-table-01`..`-10`; staff Aminah (PIN 1234), Ravi (5678).

**Shop B — "Restoran Contoh"** (`shop:b`, slug `restoran-contoh`, plan pro): the same menu plus: stations Kitchen and Drinks (Drinks items routed there); category Sets (sort 0) with Set A "Nasi lemak + Teh tarik" 700 and Set B "Roti canai + Kopi" 320 (`is_combo`); promo "Happy hour" 20% off Teh tarik, Kopi, Kopi O, Milo ais, 14:00–17:00 every day; windows Breakfast 06:00–11:30, Noodles 11:00–21:00; `ms`/`zh` translations below; tables "Table 1".."Table 4" (`lapar-local-b-table-01`..`-04`), counter "Counter" (`lapar-local-b-counter-1`); `pickup_board_token = 'lapar-local-b-pickup-01'`; staff Siti (PIN 2468).

**Menu** (both shops; prices in sen; slug in brackets):

| Category | Items |
| --- | --- |
| Drinks / Minuman / 饮料 | Teh tarik [teh-tarik] 220 拉茶 · Kopi [kopi] 200 咖啡 · Kopi O [kopi-o] 180 咖啡乌 · Milo ais [milo-ais] 320 冰美禄 · Teh O ais limau [teh-o-ais-limau] 280 冰柠檬茶 · Sirap bandung [sirap-bandung] 280 玫瑰露奶 |
| Breakfast / Sarapan / 早餐 | Roti canai [roti-canai] 150 印度煎饼 · Roti telur [roti-telur] 250 鸡蛋煎饼 · Kaya toast (ms Roti bakar kaya) [kaya-toast] 300 咖椰吐司 · Half-boiled eggs (ms Telur separuh masak) [half-boiled-eggs] 300 半生熟蛋 |
| Rice / Nasi / 饭类 | Nasi lemak [nasi-lemak] 550 椰浆饭 · Nasi lemak ayam goreng [nasi-lemak-ayam] 1050 炸鸡椰浆饭 · Nasi goreng kampung [nasi-goreng-kampung] 800 甘榜炒饭 · Nasi ayam [nasi-ayam] 850 鸡饭 |
| Noodles / Mi / 面类 | Mee goreng mamak [mee-goreng-mamak] 750 嘛嘛炒面 · Char kuey teow [char-kuey-teow] 900 炒粿条 · Mee rebus [mee-rebus] 700 卤面 |
| Sides / Sampingan / 小食 | Telur mata [telur-mata] 120 荷包蛋 · Ayam goreng [ayam-goreng] 500 炸鸡 · Extra kari (ms Kari tambahan) [extra-kari] 100 加咖喱 |
| Sets / Set / 套餐 (shop B) | Set A [set-a] 700 套餐A · Set B [set-b] 320 套餐B |

Option groups (slug `group:<shop>:<item>:<group>`; `option:<shop>:<item>:<option>`):

| Item(s) | Group [slug] (min..max): options (+sen) |
| --- | --- |
| teh-tarik, kopi, kopi-o | Panas / Ais [temp] (1..1): Panas [panas] 0, Ais [ais] +30 · Manis [sweet] (0..1): Kurang manis [kurang-manis] 0, Kosong [kosong] 0 · Bungkus [pack] (0..1): Bungkus [bungkus] +20 |
| milo-ais | Manis [sweet] (0..1): Kurang manis 0, Kosong 0 |
| roti-canai | Kuah [kuah] (1..1): Dhal [dhal] 0, Kari [kari] 0, Campur [campur] 0 · Tambah [add] (0..2): Telur [telur] +100, Bawang [bawang] +50 |
| nasi-lemak | Tambah [add] (0..3): Telur mata [telur-mata] +120, Ayam goreng [ayam-goreng] +500, Sambal extra [sambal] +50 |
| mee-goreng-mamak | Pedas [spice] (1..1): Biasa [biasa] 0, Pedas [pedas] 0, Tak pedas [tak-pedas] 0 · Tambah [add] (0..1): Telur [telur] +100 |
| char-kuey-teow | Pedas [spice] (1..1): Biasa 0, Pedas 0, Tak pedas 0 |

Pairings (both shops): nasi-lemak → teh-tarik, telur-mata, ayam-goreng · roti-canai → teh-tarik, telur-mata, extra-kari · kaya-toast → half-boiled-eggs, kopi. Combo components (shop B): set-a = nasi-lemak ×1 + teh-tarik ×1; set-b = roti-canai ×1 + kopi ×1. Option translations are not seeded (names are already Malay).

**History** (appended by card M2-E): for each shop and each MYT day from today−30 to today−1, a deterministic generator (`perform setseed(0.42)` once, then `random()`): 18–30 orders a day (weekends ×1.3), hours weighted to 07–09, 12–14 and 18–20; table 1..n; a main dish (Breakfast before 11:00, Rice/Noodles after), a drink 80%, a side 30%; pairing bias (nasi lemak + teh tarik 60%, roti canai + teh tarik 50% + extra kari 30%, kaya toast + half-boiled eggs 70% + kopi 60%); 25% of paired lines carry `suggested_from_item_id`; shop B adds sets on 10% of orders. Every order approved 1–3 min after creation, lines served (`ready_at` 3–15 min after approval, drinks 2–5), one tab per order closed and paid (cash 60%, DuitNow 30%, card 10%, cash rounded). End with `select public.refresh_auto_pairings();`.

## 12. Files

| Migration | Card | Contents |
| --- | --- | --- |
| `supabase/migrations/20261125000100_schema.sql` | M2-A | Extensions check, default-privilege revokes, enums, all tables, constraints, indexes, `new_token`, `try_uuid`, `myt_today`, `in_window`, `round_cash`, entitlement/plan rows, platform_settings row. |
| `..._000200_security.sql` | M2-B | Section 5 helpers (0200), triggers (section 4), grants, RLS policies, publication, storage. |
| `..._000300_customer_rpcs.sql` | M2-C | 6.1, `next_pickup_no`, `tab_money`. |
| `..._000400_staff_rpcs.sql` | M2-D | 6.2, 6.3. |
| `..._000500_owner_rpcs.sql` | M2-E | 6.4, 6.5, `assert_report_window`, `auto_pairings_on_gain`, cron. |
| `..._000600_admin_rpcs.sql` | M4-A | 6.6. |
| Later fixes | orchestrator assigns | Next free number `..._000700_<topic>.sql`; never edit a merged migration. |

pgTAP files live in `supabase/tests/database/` (`NNN_topic.test.sql`, each `begin; select plan(n); ... select * from finish(); rollback;`). Impersonate with `set local role anon;` or `set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);`. Give a device a staff session by inserting into `staff_sessions` before switching role.
