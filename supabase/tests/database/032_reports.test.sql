begin;
select plan(45);

-- Fixtures (as postgres, owner claims set per block): known orders for A today.
create function pg_temp.mk_line(p_order uuid, p_no int, p_k text, p_slug text, p_qty int, p_unit int, p_opt int, p_status public.item_status)
returns void language sql as $$
  insert into public.order_items (shop_id, order_id, line_no, item_id, name_snapshot, list_price_sen, unit_price_sen, options_price_sen,
    qty, station_id, status)
  select i.shop_id, p_order, p_no, i.id, i.name, p_unit, p_unit, p_opt, p_qty, i.station_id, p_status
  from public.items i where i.id = md5('item:' || p_k || ':' || p_slug)::uuid
$$;
insert into public.tabs (id, shop_id, table_id, kind) values
  (md5('t:1')::uuid, md5('shop:a')::uuid, md5('table:a:05')::uuid, 'table'),
  (md5('t:2')::uuid, md5('shop:a')::uuid, md5('table:a:06')::uuid, 'table');
insert into public.orders (id, shop_id, tab_id, status, approved_at) values
  (md5('o:1')::uuid, md5('shop:a')::uuid, md5('t:1')::uuid, 'approved', now()),
  (md5('o:2')::uuid, md5('shop:a')::uuid, md5('t:1')::uuid, 'approved', now()),
  (md5('o:3')::uuid, md5('shop:a')::uuid, md5('t:2')::uuid, 'pending_approval', null),
  (md5('o:4')::uuid, md5('shop:a')::uuid, md5('t:2')::uuid, 'approved', now()),
  (md5('o:5')::uuid, md5('shop:a')::uuid, md5('t:2')::uuid, 'rejected', null);
select pg_temp.mk_line(md5('o:1')::uuid, 1, 'a', 'kopi', 2, 200, 0, 'new');
select pg_temp.mk_line(md5('o:1')::uuid, 2, 'a', 'nasi-lemak', 1, 550, 120, 'new');
select pg_temp.mk_line(md5('o:1')::uuid, 3, 'a', 'ayam-goreng', 1, 500, 0, 'cancelled');
select pg_temp.mk_line(md5('o:2')::uuid, 1, 'a', 'roti-canai', 1, 150, 0, 'new');
select pg_temp.mk_line(md5('o:3')::uuid, 1, 'a', 'kopi', 1, 200, 0, 'pending');
select pg_temp.mk_line(md5('o:4')::uuid, 1, 'a', 'teh-tarik', 1, 221, 0, 'new');
select pg_temp.mk_line(md5('o:5')::uuid, 1, 'a', 'milo-ais', 1, 320, 0, 'cancelled');

select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);

-- Daily summary for the known orders (pending, rejected and cancelled lines excluded; half-up average)
create temp table _d as select public.get_daily_summary(md5('shop:a')::uuid, public.myt_today()) as r;
select is((select r ->> 'day' from _d), public.myt_today()::text, 'day echoed');
select is((select (r ->> 'salesSen')::int from _d), 1441, 'sales = 400 + 670 + 150 + 221');
select is((select (r ->> 'orders')::int from _d), 3, 'three approved orders');
select is((select (r ->> 'bills')::int from _d), 2, 'two bills (distinct tabs)');
select is((select (r ->> 'averageBillSen')::int from _d), 721, '1441 / 2 = 720.5 rounds half up to 721');
select is((select array_agg(t ->> 'name' order by o) from _d, jsonb_array_elements(r -> 'topItems') with ordinality x (t, o)),
  array['Kopi', 'Nasi lemak', 'Teh tarik', 'Roti canai'], 'top items: quantity, then revenue');
select is((select r -> 'topItems' -> 0 ->> 'qty' from _d), '2', 'top item quantity');

-- A yesterday matches an independent aggregate over the seeded history
select is((public.get_daily_summary(md5('shop:a')::uuid, public.myt_today() - 1) ->> 'salesSen')::bigint,
  (select sum(oi.line_total_sen) from public.order_items oi join public.orders o on o.id = oi.order_id
   where o.shop_id = md5('shop:a')::uuid and o.status = 'approved' and oi.status <> 'cancelled' and oi.kind <> 'component'
     and (o.created_at at time zone 'Asia/Kuala_Lumpur')::date = public.myt_today() - 1), 'yesterday: sales match the raw lines');
select is((public.get_daily_summary(md5('shop:a')::uuid, public.myt_today() - 1) ->> 'bills')::bigint,
  (select count(distinct o.tab_id) from public.orders o
   where o.shop_id = md5('shop:a')::uuid and o.status = 'approved'
     and (o.created_at at time zone 'Asia/Kuala_Lumpur')::date = public.myt_today() - 1), 'yesterday: bills match the tabs');
select is(jsonb_array_length(public.get_daily_summary(md5('shop:a')::uuid, public.myt_today() - 1) -> 'topItems'), 5, 'top five only');

-- Report window: Basic sees 30 days including today (D32)
select lives_ok($$select public.get_daily_summary(md5('shop:a')::uuid, public.myt_today() - 29)$$, 'A: 29 days ago is visible');
select throws_ok($$select public.get_daily_summary(md5('shop:a')::uuid, public.myt_today() - 30)$$, 'P0001', 'outside_report_window', 'A: 30 days ago is outside the window');
select throws_ok($$select public.get_daily_summary(md5('shop:a')::uuid, public.myt_today() - 31)$$, 'P0001', 'outside_report_window', 'A: 31 days ago is outside the window');
select throws_ok($$select public.get_daily_summary(md5('shop:a')::uuid, public.myt_today() + 1)$$, 'P0001', 'invalid_input', 'a future day is invalid');
select throws_ok($$select public.get_daily_summary(md5('shop:a')::uuid, null)$$, 'P0001', 'invalid_input', 'null day is invalid');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
select cmp_ok((public.get_daily_summary(md5('shop:b')::uuid, public.myt_today() - 30) ->> 'salesSen')::int, '>', 0, 'B: 30 days ago is visible and has sales');
select is((public.get_daily_summary(md5('shop:b')::uuid, public.myt_today() - 400) ->> 'salesSen')::int, 0, 'B: unlimited history, an empty day is zero');
select is((public.get_daily_summary(md5('shop:b')::uuid, public.myt_today() - 400) ->> 'averageBillSen')::int, 0, 'no bills: average 0');
select throws_ok($$select public.get_daily_summary(md5('shop:a')::uuid, public.myt_today())$$, 'P0001', 'forbidden', 'owner B cannot read A summary');

-- get_shop_plan
select is(public.get_shop_plan(md5('shop:b')::uuid) ->> 'planId', 'pro', 'B plan');
select is(public.get_shop_plan(md5('shop:b')::uuid) -> 'usage', '{"tables": 4, "stations": 2, "staff": 1}'::jsonb, 'B usage: the counter does not count');
select is(public.get_shop_plan(md5('shop:b')::uuid) -> 'entitlements' -> 'limits' -> 'max_tables', 'null'::jsonb, 'B: unlimited tables');
select is(public.get_shop_plan(md5('shop:b')::uuid) -> 'askTerasWhatsapp', 'null'::jsonb, 'no WhatsApp number yet');
update public.platform_settings set whatsapp_number = '111222333444';
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select is(public.get_shop_plan(md5('shop:a')::uuid) ->> 'askTerasWhatsapp', '111222333444', 'the platform WhatsApp number is returned');
select is(public.get_shop_plan(md5('shop:a')::uuid) -> 'usage', '{"tables": 10, "stations": 1, "staff": 2}'::jsonb, 'A usage');
select is(public.get_shop_plan(md5('shop:a')::uuid) -> 'entitlements' -> 'limits' -> 'max_tables', '15'::jsonb, 'A: 15 tables');
select throws_ok($$select public.get_shop_plan(md5('shop:b')::uuid)$$, 'P0001', 'forbidden', 'owner A cannot read B plan');

-- Sales report (B, Pro): totals, 24 hours, zero sellers, prep times
insert into public.items (shop_id, category_id, station_id, name, price_sen)
  values (md5('shop:b')::uuid, md5('cat:b:drinks')::uuid, md5('station:b:drinks')::uuid, 'Cendol', 400);
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
create temp table _s as select public.get_sales_report(md5('shop:b')::uuid, public.myt_today() - 29, public.myt_today() - 1) as r;
select is((select jsonb_array_length(r -> 'byDay') from _s), 29, 'one entry per day');
select is((select jsonb_array_length(r -> 'byHour') from _s), 24, '24 hour entries');
select is((select sum((d ->> 'salesSen')::int) from _s, jsonb_array_elements(r -> 'byDay') d), (select (r ->> 'salesSen')::bigint from _s), 'total = sum of days');
select is((select sum((d ->> 'salesSen')::int) from _s, jsonb_array_elements(r -> 'byHour') d), (select (r ->> 'salesSen')::bigint from _s), 'total = sum of hours');
select is((select sum((d ->> 'orders')::int) from _s, jsonb_array_elements(r -> 'byDay') d), (select (r ->> 'orders')::bigint from _s), 'orders = sum of days');
select is((select (r ->> 'salesSen')::bigint from _s),
  (select sum(oi.line_total_sen) from public.order_items oi join public.orders o on o.id = oi.order_id
   where o.shop_id = md5('shop:b')::uuid and o.status = 'approved' and oi.status <> 'cancelled' and oi.kind <> 'component'
     and (o.created_at at time zone 'Asia/Kuala_Lumpur')::date between public.myt_today() - 29 and public.myt_today() - 1), 'total matches the raw lines');
select is((select (i ->> 'qty')::int || '/' || (i ->> 'revenueSen')::int from _s, jsonb_array_elements(r -> 'items') i where i ->> 'name' = 'Cendol'), '0/0', 'a zero seller is listed');
select is((select jsonb_array_length(r -> 'items') from _s), (select count(*)::int from public.items where shop_id = md5('shop:b')::uuid and active), 'every active item is listed');
select ok((select bool_and((a ->> 'revenueSen')::int >= (b ->> 'revenueSen')::int)
  from _s, jsonb_array_elements(r -> 'items') with ordinality x (a, i), jsonb_array_elements(r -> 'items') with ordinality y (b, j) where j = i + 1), 'items are sorted by revenue');
select is((select (r -> 'prepOverall' ->> 'count')::bigint from _s),
  (select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id
   where o.shop_id = md5('shop:b')::uuid and o.status = 'approved' and oi.ready_at is not null and oi.kind <> 'combo' and oi.status <> 'cancelled'
     and (oi.ready_at at time zone 'Asia/Kuala_Lumpur')::date between public.myt_today() - 29 and public.myt_today() - 1), 'prep count matches the ready lines');
select ok((select (r -> 'prepOverall' ->> 'avgMinutes')::numeric between 2 and 16 from _s), 'average prep minutes are plausible (seed: 2-15)');
select ok((select (r -> 'prepOverall' ->> 'medianMinutes')::numeric between 2 and 16 from _s), 'median prep minutes are plausible');
select ok((select (p ->> 'avgMinutes')::numeric from _s, jsonb_array_elements(r -> 'prep') p where p ->> 'name' = 'Teh tarik') <
          (select (p ->> 'avgMinutes')::numeric from _s, jsonb_array_elements(r -> 'prep') p where p ->> 'name' = 'Nasi lemak'), 'drinks are quicker than rice');
select throws_ok($$select public.get_sales_report(md5('shop:b')::uuid, public.myt_today(), public.myt_today() - 1)$$, 'P0001', 'invalid_input', 'from after to');
select throws_ok($$select public.get_sales_report(md5('shop:b')::uuid, public.myt_today() - 366, public.myt_today())$$, 'P0001', 'invalid_input', 'a span of 367 days is refused');
select lives_ok($$select public.get_sales_report(md5('shop:b')::uuid, public.myt_today() - 365, public.myt_today())$$, '366 days is fine');

-- Report window on the sales report (override gives A the feature and keeps its 30 days)
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:a')::uuid, 'full_reports', true, 'test');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.get_sales_report(md5('shop:a')::uuid, public.myt_today() - 35, public.myt_today())$$, 'P0001', 'outside_report_window', 'A: from before the window');
select is((public.get_sales_report(md5('shop:a')::uuid, public.myt_today(), public.myt_today()) ->> 'salesSen')::int, 1441, 'A: today matches the daily summary');

select * from finish();
rollback;
