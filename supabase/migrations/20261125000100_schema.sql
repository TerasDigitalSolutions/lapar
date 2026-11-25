-- Lapar schema (M2-A): extensions, default privileges, enums, tables, utility functions, plan data.
-- See docs/DATA-MODEL.md sections 1-3, 5, 12.

create extension if not exists pgcrypto with schema extensions;

-- Deny by default: grants are explicit in later migrations.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;

-- Enums
create type public.approval_mode as enum ('every_order', 'first_order', 'none');
create type public.tab_status as enum ('open', 'closed');
create type public.order_status as enum ('pending_approval', 'approved', 'rejected', 'cancelled');
create type public.item_status as enum ('pending', 'new', 'preparing', 'cooking', 'ready', 'served', 'cancelled');
create type public.service_reason as enum ('bill', 'water', 'other');
create type public.service_status as enum ('open', 'acknowledged', 'done');
create type public.photo_state as enum ('none', 'staging', 'published');
create type public.paid_method as enum ('cash', 'duitnow', 'card', 'other');
create type public.table_kind as enum ('table', 'counter');
create type public.line_kind as enum ('item', 'combo', 'component');
create type public.discount_type as enum ('percent', 'amount');

-- Utility functions
create function public.new_token() returns text
language sql security definer set search_path = '' volatile
as $$ select translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_') $$;

create function public.try_uuid(p text) returns uuid
language plpgsql security definer set search_path = '' immutable
as $$ begin return p::uuid; exception when others then return null; end $$;

create function public.myt_today() returns date
language sql security definer set search_path = '' stable
as $$ select (now() at time zone 'Asia/Kuala_Lumpur')::date $$;

create function public.in_window(p_from time, p_to time, p_days smallint[], p_at timestamptz) returns boolean
language sql security definer set search_path = '' stable
as $$
  with l as (select p_at at time zone 'Asia/Kuala_Lumpur' as ts)
  select (p_days is null or extract(isodow from l.ts)::smallint = any (p_days))
     and case when p_from < p_to then l.ts::time >= p_from and l.ts::time < p_to
              else l.ts::time >= p_from or l.ts::time < p_to end
  from l
$$;

create function public.round_cash(p_sen int) returns int
language sql security definer set search_path = '' immutable
as $$ select case p_sen % 5 when 0 then p_sen when 1 then p_sen - 1 when 2 then p_sen - 2
                          when 3 then p_sen + 2 else p_sen + 1 end $$;

grant execute on function public.new_token(), public.try_uuid(text) to authenticated;

-- 3.1 Plans and platform
create table public.entitlement_keys (
  key text primary key,
  kind text not null check (kind in ('feature', 'limit'))
);
create table public.plans (
  id text primary key check (id in ('basic', 'pro')),
  name text not null
);
create table public.plan_features (
  plan_id text not null references public.plans (id),
  feature_key text not null references public.entitlement_keys (key),
  enabled boolean not null default true,
  limit_value int null check (limit_value >= 0),
  primary key (plan_id, feature_key)
);
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.platform_settings (
  id boolean primary key default true check (id),
  whatsapp_number text null check (whatsapp_number ~ '^[0-9]{8,15}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users (id) on delete set null
);

-- 3.2 Shops and people
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$'),
  logo_url text null check (logo_url ~ '^https?://'),
  plan_id text not null default 'basic' references public.plans (id),
  approval_mode public.approval_mode not null default 'first_order',
  nudge_category_id uuid null,
  active boolean not null default true,
  pickup_board_token text null unique check (char_length(pickup_board_token) >= 22),
  created_at timestamptz not null default now()
);
create table public.shop_owners (
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index on public.shop_owners (user_id);
create table public.shop_feature_overrides (
  shop_id uuid not null references public.shops (id) on delete cascade,
  feature_key text not null references public.entitlement_keys (key),
  enabled boolean null,
  limit_value int null check (limit_value >= 0),
  note text not null check (char_length(note) between 1 and 200),
  changed_by uuid null references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (shop_id, feature_key)
);
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, id)
);
create index on public.staff (shop_id);
create table public.staff_pins (
  staff_id uuid primary key,
  shop_id uuid not null,
  pin_hash text not null,
  updated_at timestamptz not null default now(),
  foreign key (shop_id, staff_id) references public.staff (shop_id, id) on delete cascade
);
create table public.staff_sessions (
  auth_uid uuid primary key references auth.users (id) on delete cascade,
  shop_id uuid not null,
  staff_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (shop_id, staff_id) references public.staff (shop_id, id) on delete cascade
);
create index on public.staff_sessions (shop_id);
create index on public.staff_sessions (staff_id);
create table public.pin_attempts (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  failures int not null default 0,
  locked_until timestamptz null,
  updated_at timestamptz not null default now()
);

-- 3.3 Menu
create table public.stations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, id)
);
create index on public.stations (shop_id, sort);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  translations jsonb not null default '{}',
  sort int not null default 0,
  available_from time null,
  available_to time null,
  available_days smallint[] null,
  created_at timestamptz not null default now(),
  unique (shop_id, id),
  check ((available_from is null) = (available_to is null)),
  check (available_from <> available_to),
  check (available_days is null or (available_days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(available_days) > 0))
);
create index on public.categories (shop_id, sort);
alter table public.shops add foreign key (id, nudge_category_id)
  references public.categories (shop_id, id) on delete set null (nudge_category_id);
create table public.items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  category_id uuid not null,
  station_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  translations jsonb not null default '{}',
  price_sen int not null check (price_sen between 0 and 10000000),
  photo_url text null,
  photo_state public.photo_state not null default 'none',
  active boolean not null default true,
  sold_out boolean not null default false,
  is_combo boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id),
  foreign key (shop_id, category_id) references public.categories (shop_id, id),
  foreign key (shop_id, station_id) references public.stations (shop_id, id),
  check ((photo_state = 'none') = (photo_url is null)),
  check (photo_state <> 'published' or photo_url like 'menu/%'),
  check (photo_state <> 'staging' or photo_url ~ '^https?://')
);
create index on public.items (shop_id, category_id, sort);
create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  item_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  translations jsonb not null default '{}',
  min_select smallint not null default 0 check (min_select >= 0),
  max_select smallint not null default 1,
  sort int not null default 0,
  unique (shop_id, id),
  check (max_select >= 1 and max_select >= min_select),
  foreign key (shop_id, item_id) references public.items (shop_id, id) on delete cascade
);
create table public.modifier_options (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  group_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  translations jsonb not null default '{}',
  price_delta_sen int not null default 0 check (price_delta_sen between 0 and 1000000),
  sort int not null default 0,
  unique (shop_id, id),
  foreign key (shop_id, group_id) references public.modifier_groups (shop_id, id) on delete cascade
);
create table public.item_pairings (
  shop_id uuid not null,
  source_item_id uuid not null,
  suggested_item_id uuid not null,
  position smallint not null check (position between 1 and 3),
  primary key (source_item_id, position),
  unique (source_item_id, suggested_item_id),
  check (source_item_id <> suggested_item_id),
  foreign key (shop_id, source_item_id) references public.items (shop_id, id) on delete cascade,
  foreign key (shop_id, suggested_item_id) references public.items (shop_id, id) on delete cascade
);
create table public.auto_pairings (
  shop_id uuid not null,
  source_item_id uuid not null,
  suggested_item_id uuid not null,
  position smallint not null check (position between 1 and 3),
  support int not null,
  confidence real not null,
  computed_at timestamptz not null default now(),
  primary key (source_item_id, position),
  unique (source_item_id, suggested_item_id),
  check (source_item_id <> suggested_item_id),
  foreign key (shop_id, source_item_id) references public.items (shop_id, id) on delete cascade,
  foreign key (shop_id, suggested_item_id) references public.items (shop_id, id) on delete cascade
);
create table public.combo_components (
  shop_id uuid not null,
  combo_item_id uuid not null,
  item_id uuid not null,
  qty smallint not null check (qty between 1 and 10),
  sort int not null default 0,
  primary key (combo_item_id, item_id),
  check (combo_item_id <> item_id),
  foreign key (shop_id, combo_item_id) references public.items (shop_id, id) on delete cascade,
  foreign key (shop_id, item_id) references public.items (shop_id, id) on delete cascade
);
create table public.promos (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  translations jsonb not null default '{}',
  discount_type public.discount_type not null,
  discount_value int not null check (discount_value > 0),
  days smallint[] not null default '{1,2,3,4,5,6,7}'
    check (days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(days) > 0),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, id),
  check (discount_type <> 'percent' or discount_value <= 100),
  check (start_time <> end_time)
);
create table public.promo_items (
  shop_id uuid not null,
  promo_id uuid not null,
  item_id uuid not null,
  primary key (promo_id, item_id),
  foreign key (shop_id, promo_id) references public.promos (shop_id, id) on delete cascade,
  foreign key (shop_id, item_id) references public.items (shop_id, id) on delete cascade
);

-- 3.4 Service
create table public.tables (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 20),
  kind public.table_kind not null default 'table',
  token text not null default public.new_token() unique check (char_length(token) >= 22),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (shop_id, id)
);
create unique index tables_label_active on public.tables (shop_id, lower(label)) where active;
create table public.tabs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  table_id uuid not null,
  kind public.table_kind not null,
  status public.tab_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz null,
  pickup_no int null,
  pickup_at timestamptz null,
  paid_total_sen int null check (paid_total_sen >= 0),
  rounding_sen int null,
  updated_at timestamptz not null default now(),
  unique (shop_id, id),
  foreign key (shop_id, table_id) references public.tables (shop_id, id),
  check ((status = 'closed') = (closed_at is not null)),
  check (kind = 'counter' or (pickup_no is null and pickup_at is null))
);
create unique index tabs_one_open_per_table on public.tabs (table_id) where status = 'open' and kind = 'table';
create index on public.tabs (shop_id, status);
create index on public.tabs (table_id, status);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  tab_id uuid not null,
  status public.order_status not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz null,
  approved_by_staff_id uuid null,
  rejected_reason text null check (char_length(rejected_reason) <= 140),
  unique (shop_id, id),
  foreign key (shop_id, tab_id) references public.tabs (shop_id, id),
  foreign key (shop_id, approved_by_staff_id) references public.staff (shop_id, id)
);
create index on public.orders (shop_id, status);
create index on public.orders (tab_id);
create index on public.orders (shop_id, created_at);
create table public.tab_payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  tab_id uuid not null,
  method public.paid_method not null,
  amount_sen int not null check (amount_sen > 0),
  rounding_sen int not null default 0 check (rounding_sen between -2 and 2),
  created_at timestamptz not null default now(),
  created_by_staff_id uuid null,
  unique (shop_id, id),
  foreign key (shop_id, tab_id) references public.tabs (shop_id, id),
  foreign key (shop_id, created_by_staff_id) references public.staff (shop_id, id)
);
create index on public.tab_payments (tab_id);
create index on public.tab_payments (shop_id, created_at);
create table public.board_columns (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  station_id uuid not null,
  name text not null check (char_length(name) between 1 and 24),
  core_status public.item_status not null check (core_status in ('new', 'preparing', 'cooking', 'ready')),
  sort int not null,
  unique (shop_id, id),
  foreign key (shop_id, station_id) references public.stations (shop_id, id) on delete cascade
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  order_id uuid not null,
  line_no smallint not null,
  kind public.line_kind not null default 'item',
  parent_line_id uuid null,
  item_id uuid not null,
  name_snapshot text not null,
  list_price_sen int not null check (list_price_sen >= 0),
  unit_price_sen int not null check (unit_price_sen >= 0),
  promo_id uuid null,
  qty smallint not null check (qty between 1 and 999),
  options jsonb not null default '[]',
  options_price_sen int not null default 0 check (options_price_sen >= 0),
  line_total_sen int generated always as (qty * (unit_price_sen + options_price_sen)) stored,
  note text null check (char_length(note) <= 140),
  station_id uuid not null,
  status public.item_status not null,
  status_changed_at timestamptz not null default now(),
  column_id uuid null,
  ready_at timestamptz null,
  served_at timestamptz null,
  suggested_from_item_id uuid null,
  paid_payment_id uuid null,
  created_at timestamptz not null default now(),
  unique (shop_id, id),
  unique (order_id, line_no),
  foreign key (shop_id, order_id) references public.orders (shop_id, id),
  foreign key (shop_id, item_id) references public.items (shop_id, id),
  foreign key (shop_id, station_id) references public.stations (shop_id, id),
  foreign key (shop_id, parent_line_id) references public.order_items (shop_id, id),
  foreign key (shop_id, promo_id) references public.promos (shop_id, id) on delete set null (promo_id),
  foreign key (shop_id, column_id) references public.board_columns (shop_id, id) on delete set null (column_id),
  foreign key (shop_id, suggested_from_item_id) references public.items (shop_id, id),
  foreign key (shop_id, paid_payment_id) references public.tab_payments (shop_id, id)
);
create index on public.order_items (shop_id, status);
create index on public.order_items (order_id);
create index on public.order_items (shop_id, station_id, status);
create index on public.order_items (suggested_from_item_id) where suggested_from_item_id is not null;
create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  table_id uuid not null,
  tab_id uuid null,
  reason public.service_reason not null,
  note text null check (char_length(note) <= 140),
  status public.service_status not null default 'open',
  tap_count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  acknowledged_at timestamptz null,
  done_at timestamptz null,
  foreign key (shop_id, table_id) references public.tables (shop_id, id),
  foreign key (shop_id, tab_id) references public.tabs (shop_id, id)
);
create unique index service_requests_merge on public.service_requests (table_id, reason) where status <> 'done';
create index on public.service_requests (shop_id, status);
create table public.pickup_counters (
  shop_id uuid not null references public.shops (id) on delete cascade,
  day date not null,
  last_no int not null,
  primary key (shop_id, day)
);

-- RLS on every table (policies come in migration 0200)
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Entitlement data (= PLAN_DEFAULTS in app/src/entitlements/keys.ts)
insert into public.entitlement_keys (key, kind) values
  ('qr_ordering','feature'),('modifiers','feature'),('call_server','feature'),('approvals','feature'),
  ('kitchen_board','feature'),('manual_pairings','feature'),('checkout_nudge','feature'),
  ('manual_payments','feature'),('daily_summary','feature'),('menu_editor','feature'),
  ('table_qr','feature'),('staff_pins','feature'),
  ('auto_pairings','feature'),('upsell_report','feature'),('combos','feature'),('promos','feature'),
  ('timed_menus','feature'),('multi_language_menu','feature'),('multi_station','feature'),
  ('printing','feature'),('takeaway','feature'),('bill_split','feature'),('custom_columns','feature'),
  ('full_reports','feature'),('export_backup','feature'),
  ('max_tables','limit'),('max_stations','limit'),('max_staff','limit'),('report_history_days','limit');
insert into public.plans (id, name) values ('basic', 'Lapar Basic'), ('pro', 'Lapar Pro');
insert into public.plan_features (plan_id, feature_key, enabled, limit_value)
select p.id, k.key,
  case when k.kind = 'limit' then true
       else p.id = 'pro' or k.key in ('qr_ordering','modifiers','call_server','approvals','kitchen_board',
         'manual_pairings','checkout_nudge','manual_payments','daily_summary','menu_editor','table_qr','staff_pins') end,
  case when k.kind = 'limit' and p.id = 'basic'
       then case k.key when 'max_tables' then 15 when 'max_stations' then 1 when 'max_staff' then 3 else 30 end end
from public.plans p cross join public.entitlement_keys k;
insert into public.platform_settings (id) values (true);
