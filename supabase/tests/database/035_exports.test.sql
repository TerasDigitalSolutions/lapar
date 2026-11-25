begin;
select plan(33);

select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);

-- export_shop_meta (B)
create temp table _m as select public.export_shop_meta(md5('shop:b')::uuid) as r;
select is((select (r ->> 'version')::int from _m), 1, 'version 1');
select ok((select r ->> 'exportedAt' is not null from _m), 'exportedAt');
select is((select r -> 'shop' ->> 'slug' from _m), 'restoran-contoh', 'shop settings');
select is((select r -> 'shop' ->> 'pickupBoardToken' from _m), 'lapar-local-b-pickup-01', 'shop pickup token');
select is((select array_agg(k order by k) from _m, jsonb_object_keys(r) k),
  array['boardColumns', 'categories', 'comboComponents', 'exportedAt', 'groups', 'items', 'options', 'pairings', 'promos', 'shop',
        'staff', 'stations', 'tables', 'version'], 'ShopExportMeta keys');
select is((select jsonb_array_length(r -> 'categories') from _m), 6, 'six categories');
select is((select jsonb_array_length(r -> 'items') from _m), 22, '22 items');
select is((select jsonb_array_length(r -> 'tables') from _m), 5, 'four tables and the counter');
select is((select jsonb_array_length(r -> 'staff') from _m), 1, 'one staff member');
select is((select jsonb_array_length(r -> 'comboComponents') from _m), 4, 'four set components');
select is((select jsonb_array_length(r -> 'stations') from _m), 2, 'two stations');
select is((select jsonb_array_length(r -> 'promos') from _m), 1, 'the happy hour promo');
select is((select jsonb_array_length(r -> 'promos' -> 0 -> 'itemIds') from _m), 4, 'its four items');
select is((select r -> 'promos' -> 0 ->> 'startTime' from _m), '14:00', 'promo times as HH:MM');
select is((select array_agg(k order by k) from _m, jsonb_object_keys(r -> 'staff' -> 0) k), array['active', 'createdAt', 'id', 'name', 'shopId'], 'StaffRow only: no PIN data');
select is((select r::text ~ 'pin_hash|pinHash|\$2[aby]\$|auth_uid|expires_at' from _m), false, 'no PIN hashes or sessions anywhere in the export');
select is((select r -> 'tables' -> 4 ->> 'kind' from _m), 'counter', 'tables include the counter (sorted)');

-- export_orders (B)
create temp table _o as select public.export_orders(md5('shop:b')::uuid, public.myt_today() - 2, public.myt_today() - 1) as r;
select is((select jsonb_array_length(r -> 'orders') from _o),
  (select count(*)::int from public.orders where shop_id = md5('shop:b')::uuid
   and (created_at at time zone 'Asia/Kuala_Lumpur')::date between public.myt_today() - 2 and public.myt_today() - 1), 'orders in range');
select is((select sum(jsonb_array_length(o -> 'lines')) from _o, jsonb_array_elements(r -> 'orders') o),
  (select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id where o.shop_id = md5('shop:b')::uuid
   and (o.created_at at time zone 'Asia/Kuala_Lumpur')::date between public.myt_today() - 2 and public.myt_today() - 1), 'every line is included');
select is((select jsonb_array_length(r -> 'payments') from _o), (select jsonb_array_length(r -> 'orders') from _o), 'one payment per seeded order');
select is((select r -> 'orders' -> 0 ->> 'tableKind' from _o), 'table', 'tableKind');
select ok((select r -> 'orders' -> 0 ->> 'tableLabel' like 'Table %' from _o), 'tableLabel');
select is((select r -> 'orders' -> 0 -> 'pickupNo' from _o), 'null'::jsonb, 'pickupNo null for tables');
select is((select r -> 'payments' -> 0 -> 'orderItemIds' from _o), '[]'::jsonb, 'a full payment settles no individual lines');
select ok((select bool_and((p ->> 'tableLabel') is not null and (p ->> 'tabId') is not null) from _o, jsonb_array_elements(r -> 'payments') p), 'payments carry tab and table');
select is((select r -> 'orders' -> 0 -> 'lines' -> 0 ->> 'status' from _o), 'served', 'StaffLineDTO status');
select is((select (select array_agg(l ->> 'name') from jsonb_array_elements(o -> 'lines') l where l ->> 'kind' = 'component') is not null
           from _o, jsonb_array_elements(r -> 'orders') o where exists (select 1 from jsonb_array_elements(o -> 'lines') l where l ->> 'kind' = 'combo') limit 1),
  true, 'sets export with their component lines');

-- Span and gates
select lives_ok($$select public.export_orders(md5('shop:b')::uuid, public.myt_today() - 92, public.myt_today())$$, '93 days is fine');
select throws_ok($$select public.export_orders(md5('shop:b')::uuid, public.myt_today() - 93, public.myt_today())$$, 'P0001', 'invalid_input', 'a span of 94 days: invalid_input');
select throws_ok($$select public.export_orders(md5('shop:b')::uuid, public.myt_today(), public.myt_today() - 1)$$, 'P0001', 'invalid_input', 'from after to: invalid_input');

-- A backup is not limited by the report window
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, limit_value, note) values (md5('shop:b')::uuid, 'report_history_days', null, 3, 'test');
select throws_ok($$select public.get_sales_report(md5('shop:b')::uuid, public.myt_today() - 10, public.myt_today())$$, 'P0001', 'outside_report_window', 'the report window is enforced for reports');
select is(jsonb_array_length(public.export_orders(md5('shop:b')::uuid, public.myt_today() - 10, public.myt_today() - 8) -> 'orders') > 0, true, 'but not for exports');

-- Isolation
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.export_shop_meta(md5('shop:b')::uuid)$$, 'P0001', 'forbidden', 'owner A cannot export B');

select * from finish();
rollback;
