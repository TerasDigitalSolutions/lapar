begin;
select plan(34);

-- Tables and RLS
select tables_are('public', array[
  'entitlement_keys','plans','plan_features','platform_admins','platform_settings',
  'shops','shop_owners','shop_feature_overrides','staff','staff_pins','staff_sessions','pin_attempts',
  'stations','categories','items','modifier_groups','modifier_options','item_pairings','auto_pairings',
  'combo_components','promos','promo_items',
  'tables','tabs','orders','order_items','service_requests','tab_payments','board_columns','pickup_counters'
], 'exactly the 30 tables exist');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0::bigint, 'RLS on for every table');
select is((select count(*) from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon', 'authenticated')), 0::bigint, 'no table grants for client roles yet');

-- Entitlements
select is((select count(*) from public.entitlement_keys where kind = 'feature'), 25::bigint, '25 feature keys');
select is((select count(*) from public.entitlement_keys where kind = 'limit'), 4::bigint, '4 limit keys');
select is((select count(*) from public.plan_features), 58::bigint, '58 plan_features rows');
select is((select count(*) from public.plan_features f join public.entitlement_keys k on k.key = f.feature_key
           where f.plan_id = 'basic' and k.kind = 'feature' and f.enabled), 12::bigint, 'basic has 12 features on');
select is((select count(*) from public.plan_features f join public.entitlement_keys k on k.key = f.feature_key
           where f.plan_id = 'pro' and k.kind = 'feature' and f.enabled), 25::bigint, 'pro has 25 features on');
select is((select array_agg(feature_key order by feature_key) from public.plan_features
           where plan_id = 'basic' and enabled and feature_key in
             ('qr_ordering','modifiers','call_server','approvals','kitchen_board','manual_pairings','checkout_nudge',
              'manual_payments','daily_summary','menu_editor','table_qr','staff_pins')),
  (select array_agg(k order by k) from unnest(array['qr_ordering','modifiers','call_server','approvals','kitchen_board',
     'manual_pairings','checkout_nudge','manual_payments','daily_summary','menu_editor','table_qr','staff_pins']) k),
  'basic features are exactly BASIC_FEATURES');
select is((select jsonb_object_agg(feature_key, limit_value) from public.plan_features where plan_id = 'basic'
           and feature_key in ('max_tables','max_stations','max_staff','report_history_days')),
  '{"max_tables":15,"max_stations":1,"max_staff":3,"report_history_days":30}'::jsonb, 'basic limits');
select is((select count(*) from public.plan_features where plan_id = 'pro' and limit_value is not null), 0::bigint, 'pro limits unlimited');
select is((select count(*) from public.platform_settings where whatsapp_number is null), 1::bigint, 'one platform_settings row, number unset');

-- round_cash
select is(public.round_cash(1233), 1235, 'round_cash 1233');
select is(public.round_cash(1232), 1230, 'round_cash 1232');
select is(public.round_cash(1231), 1230, 'round_cash 1231');
select is(public.round_cash(1234), 1235, 'round_cash 1234');
select is(public.round_cash(1230), 1230, 'round_cash 1230');

-- in_window (2026-11-25 is a Wednesday, isodow 3; MYT = UTC+8)
select is(public.in_window('11:00', '21:00', null, '2026-11-25 06:30+00'), true, 'in window 14:30 MYT');
select is(public.in_window('11:00', '21:00', null, '2026-11-25 13:00+00'), false, 'out of window 21:00 MYT (end exclusive)');
select is(public.in_window('11:00', '21:00', null, '2026-11-25 03:00+00'), true, 'start inclusive 11:00 MYT');
select is(public.in_window('22:00', '02:00', null, '2026-11-25 15:00+00'), true, 'wrapping window, 23:00 MYT');
select is(public.in_window('22:00', '02:00', null, '2026-11-25 17:00+00'), true, 'wrapping window, 01:00 MYT next day');
select is(public.in_window('22:00', '02:00', null, '2026-11-25 06:00+00'), false, 'wrapping window, 14:00 MYT out');
select is(public.in_window('11:00', '21:00', array[3]::smallint[], '2026-11-25 06:30+00'), true, 'weekday listed');
select is(public.in_window('11:00', '21:00', array[1,2]::smallint[], '2026-11-25 06:30+00'), false, 'weekday not listed');

-- new_token
select matches(public.new_token(), '^[A-Za-z0-9_-]{24}$', 'new_token is 24 url-safe chars');

-- Fixtures: two shops
insert into public.shops (id, name, slug) values
  (md5('shop:a')::uuid, 'Shop A', 'shop-a'), (md5('shop:b')::uuid, 'Shop B', 'shop-b');
insert into public.stations (id, shop_id, name) values
  (md5('station:a')::uuid, md5('shop:a')::uuid, 'Kitchen'), (md5('station:b')::uuid, md5('shop:b')::uuid, 'Kitchen');
insert into public.categories (id, shop_id, name) values
  (md5('cat:a')::uuid, md5('shop:a')::uuid, 'Drinks'), (md5('cat:b')::uuid, md5('shop:b')::uuid, 'Drinks');
insert into public.tables (id, shop_id, label, token) values
  (md5('table:a:1')::uuid, md5('shop:a')::uuid, 'Table 1', 'tok-aaaaaaaaaaaaaaaaaaaaaa');

select throws_ok($$insert into public.items (shop_id, category_id, station_id, name, price_sen)
  values (md5('shop:a')::uuid, md5('cat:b')::uuid, md5('station:a')::uuid, 'X', 100)$$,
  '23503', null, 'composite FK rejects an item pointing at another shop''s category');
select throws_ok($$insert into public.items (shop_id, category_id, station_id, name, price_sen)
  values (md5('shop:a')::uuid, md5('cat:a')::uuid, md5('station:a')::uuid, 'X', -1)$$,
  '23514', null, 'negative price fails');
select lives_ok($$insert into public.items (shop_id, category_id, station_id, name, price_sen)
  values (md5('shop:a')::uuid, md5('cat:a')::uuid, md5('station:a')::uuid, 'Teh', 220)$$, 'valid item inserts');
select throws_ok($$insert into public.items (shop_id, category_id, station_id, name, price_sen, photo_state, photo_url)
  values (md5('shop:a')::uuid, md5('cat:a')::uuid, md5('station:a')::uuid, 'X', 100, 'none', 'menu/x.webp')$$,
  '23514', null, 'photo_state none needs a null url');
select throws_ok($$insert into public.items (shop_id, category_id, station_id, name, price_sen, photo_state, photo_url)
  values (md5('shop:a')::uuid, md5('cat:a')::uuid, md5('station:a')::uuid, 'X', 100, 'published', 'https://x.test/a.webp')$$,
  '23514', null, 'published photo needs a menu/ path');
select throws_ok($$insert into public.items (shop_id, category_id, station_id, name, price_sen, photo_state, photo_url)
  values (md5('shop:a')::uuid, md5('cat:a')::uuid, md5('station:a')::uuid, 'X', 100, 'staging', 'menu/x.webp')$$,
  '23514', null, 'staging photo needs an http url');

insert into public.tabs (shop_id, table_id, kind) values (md5('shop:a')::uuid, md5('table:a:1')::uuid, 'table');
select throws_ok($$insert into public.tabs (shop_id, table_id, kind)
  values (md5('shop:a')::uuid, md5('table:a:1')::uuid, 'table')$$,
  '23505', null, 'second open tab for one table fails');
select throws_ok($$insert into public.tables (shop_id, label, token)
  values (md5('shop:a')::uuid, 'Table 2', 'tok-aaaaaaaaaaaaaaaaaaaaaa')$$,
  '23505', null, 'duplicate table token fails');

select * from finish();
rollback;
