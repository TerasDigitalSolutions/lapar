begin;
select plan(52);

create temp table _r (k text primary key, r jsonb);
create temp table _tab (k text primary key, id uuid);
create temp table _ln (k text, n int, id uuid);
grant all on _r, _tab, _ln to anon, authenticated;

-- Fixtures. Shop A: telur mata costs 1.83 so a tab can total 12.33. Shop B: telur mata costs 10.00.
update public.items set price_sen = 183 where id = md5('item:a:telur-mata')::uuid;
update public.items set price_sen = 1000 where id = md5('item:b:telur-mata')::uuid;
update public.shops set approval_mode = 'every_order' where id = md5('shop:a')::uuid;
update public.shops set approval_mode = 'none' where id = md5('shop:b')::uuid;
insert into public.staff_sessions (auth_uid, shop_id, staff_id, expires_at) values
  (md5('user:device-a')::uuid, md5('shop:a')::uuid, md5('staff:a:aminah')::uuid, now() + interval '16 hours'),
  (md5('user:device-b')::uuid, md5('shop:b')::uuid, md5('staff:b:siti')::uuid, now() + interval '16 hours');
set local role anon;
insert into _r select 'a1', public.place_order('lapar-local-a-table-01', jsonb_build_array(
  jsonb_build_object('itemId', md5('item:a:nasi-lemak')::uuid, 'qty', 1),
  jsonb_build_object('itemId', md5('item:a:ayam-goreng')::uuid, 'qty', 1),
  jsonb_build_object('itemId', md5('item:a:telur-mata')::uuid, 'qty', 1)));
reset role;
update public.shops set approval_mode = 'none' where id = md5('shop:a')::uuid;
set local role anon;
insert into _r select 'a2', public.place_order('lapar-local-a-table-02', jsonb_build_array(jsonb_build_object('itemId', md5('item:a:telur-mata')::uuid, 'qty', 1)));
insert into _r select 'a3', public.place_order('lapar-local-a-table-03', jsonb_build_array(jsonb_build_object('itemId', md5('item:a:telur-mata')::uuid, 'qty', 1)));
insert into _r select 'b1', public.place_order('lapar-local-b-table-01', jsonb_build_array(jsonb_build_object('itemId', md5('item:b:telur-mata')::uuid, 'qty', 1)));
insert into _r select 'b2', public.place_order('lapar-local-b-table-02', jsonb_build_array(
  jsonb_build_object('itemId', md5('item:b:nasi-lemak')::uuid, 'qty', 1),
  jsonb_build_object('itemId', md5('item:b:ayam-goreng')::uuid, 'qty', 1),
  jsonb_build_object('itemId', md5('item:b:extra-kari')::uuid, 'qty', 1)));
insert into _r select 'b3', public.place_order('lapar-local-b-table-03', jsonb_build_array(
  jsonb_build_object('itemId', md5('item:b:nasi-lemak')::uuid, 'qty', 1),
  jsonb_build_object('itemId', md5('item:b:ayam-goreng')::uuid, 'qty', 1)));
insert into _r select 'b4', public.place_order('lapar-local-b-table-04', jsonb_build_array(jsonb_build_object('itemId', md5('item:b:set-a')::uuid, 'qty', 1)));
reset role;
insert into _tab select k, (r ->> 'tabId')::uuid from _r;
insert into _ln select k, ord::int, (l ->> 'lineId')::uuid from _r, jsonb_array_elements(r -> 'lines') with ordinality t (l, ord);

-- Callers
set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select public.record_payment((select id from _tab where k = 'a2'), 'cash')$$, 'P0001', 'not_signed_in', 'no auth.uid(): not_signed_in');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:outsider')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.record_payment((select id from _tab where k = 'a2'), 'cash')$$, 'P0001', 'forbidden', 'outsider: record_payment forbidden');
select throws_ok($$select public.get_tab_detail((select id from _tab where k = 'a2'))$$, 'P0001', 'forbidden', 'outsider: get_tab_detail forbidden');
select throws_ok($$select public.get_tables_overview(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'outsider: get_tables_overview forbidden');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-b')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.record_payment((select id from _tab where k = 'a2'), 'cash')$$, 'P0001', 'forbidden', 'staff of B: record_payment on an A tab forbidden');
select throws_ok($$select public.get_tab_detail((select id from _tab where k = 'a2'))$$, 'P0001', 'forbidden', 'staff of B: get_tab_detail of an A tab forbidden');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.record_payment('00000000-0000-0000-0000-000000000001', 'cash')$$, 'P0001', 'not_found', 'unknown tab: not_found');
select throws_ok($$select public.get_tab_detail('00000000-0000-0000-0000-000000000001')$$, 'P0001', 'not_found', 'get_tab_detail: unknown tab not_found');

-- Pending orders block payment (a1 still waits for approval)
select throws_ok($$select public.record_payment((select id from _tab where k = 'a1'), 'cash')$$, 'P0001', 'pending_orders', 'tab with a pending order: pending_orders');
select is((public.get_tab_detail((select id from _tab where k = 'a1')) ->> 'hasPendingOrders')::boolean, true, 'get_tab_detail reports hasPendingOrders');
select lives_ok($$select public.approve_order((select (r ->> 'orderId')::uuid from _r where k = 'a1'))$$, 'approve a1');

-- Shop A (Basic): full payment only
select is((public.get_tab_detail((select id from _tab where k = 'a1')) ->> 'totalSen')::int, 1233, 'A tab totals 12.33');
select throws_ok($$select public.record_payment((select id from _tab where k = 'a1'), 'cash', 500)$$, 'P0001', 'feature_not_enabled', 'partial amount on A: feature_not_enabled');
select throws_ok($$select public.record_payment((select id from _tab where k = 'a1'), 'cash', null, array[(select id from _ln where k = 'a1' and n = 1)])$$, 'P0001', 'feature_not_enabled', 'item split on A: feature_not_enabled');
select throws_ok($$select public.record_payment((select id from _tab where k = 'a1'), 'cash', 1234)$$, 'P0001', 'invalid_input', 'amount above the balance: invalid_input');
select throws_ok($$select public.record_payment((select id from _tab where k = 'a1'), 'cash', 0)$$, 'P0001', 'invalid_input', 'amount 0: invalid_input');
select throws_ok($$select public.record_payment((select id from _tab where k = 'a1'), null)$$, 'P0001', 'invalid_input', 'null method: invalid_input');
reset role;
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:a')::uuid, 'manual_payments', false, 'test');
set local role authenticated;
select throws_ok($$select public.record_payment((select id from _tab where k = 'a1'), 'cash')$$, 'P0001', 'feature_not_enabled', 'manual_payments off: feature_not_enabled');
reset role;
delete from public.shop_feature_overrides where shop_id = md5('shop:a')::uuid;
set local role authenticated;
insert into _r select 'p_a1', public.record_payment((select id from _tab where k = 'a1'), 'cash');
select is((select r - 'paymentId' from _r where k = 'p_a1'), '{"amountSen": 1233, "roundingSen": 2, "remainingSen": 0, "tabClosed": true}'::jsonb, 'cash 1233: rounding +2, nothing remaining, tab closed');
select ok((select r ->> 'paymentId' is not null from _r where k = 'p_a1'), 'a payment id is returned');
reset role;
select is((select paid_total_sen || '|' || rounding_sen || '|' || status::text from public.tabs where id = (select id from _tab where k = 'a1')), '1233|2|closed', 'tab closed with paid_total_sen 1233 and rounding_sen 2');
select ok((select closed_at is not null from public.tabs where id = (select id from _tab where k = 'a1')), 'closed_at set');
select is((select created_by_staff_id from public.tab_payments where tab_id = (select id from _tab where k = 'a1')), md5('staff:a:aminah')::uuid, 'created_by_staff_id is the staff member');
set local role authenticated;
select throws_ok($$select public.record_payment((select id from _tab where k = 'a1'), 'cash')$$, 'P0001', 'tab_closed', 'paying a closed tab: tab_closed');
select is(public.get_tab_detail((select id from _tab where k = 'a1')) ->> 'status', 'closed', 'get_tab_detail: closed');
select is((public.get_tab_detail((select id from _tab where k = 'a1')) ->> 'roundingSen')::int, 2, 'get_tab_detail: roundingSen 2');
select is(jsonb_array_length(public.get_tab_detail((select id from _tab where k = 'a1')) -> 'payments'), 1, 'get_tab_detail: one payment');
select is(jsonb_array_length(public.get_tab_detail((select id from _tab where k = 'a1')) -> 'orders' -> 0 -> 'lines'), 3, 'get_tab_detail: order lines');

-- Non-cash has no rounding
insert into _r select 'p_a2', public.record_payment((select id from _tab where k = 'a2'), 'duitnow');
select is((select r - 'paymentId' from _r where k = 'p_a2'), '{"amountSen": 183, "roundingSen": 0, "remainingSen": 0, "tabClosed": true}'::jsonb, 'DuitNow 1.83: no rounding');

-- Nothing owed: the tab closes without a payment row
reset role;
update public.order_items set status = 'cancelled' where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'a3');
set local role authenticated;
insert into _r select 'p_a3', public.record_payment((select id from _tab where k = 'a3'), 'cash');
select is((select r from _r where k = 'p_a3'), '{"paymentId": null, "amountSen": 0, "roundingSen": 0, "remainingSen": 0, "tabClosed": true}'::jsonb, 'remaining 0: closed without a payment');
reset role;
select is((select count(*) from public.tab_payments where tab_id = (select id from _tab where k = 'a3')), 0::bigint, 'no payment row was written');
set local role authenticated;

-- Tables overview (A): table 1 to 3 are closed, so no open tabs
select is((select count(*) from jsonb_array_elements(public.get_tables_overview(md5('shop:a')::uuid)) t where jsonb_array_length(t -> 'openTabs') > 0), 0::bigint, 'overview: no open tabs left on A');
select is(jsonb_array_length(public.get_tables_overview(md5('shop:a')::uuid)), 10, 'overview: ten tables');

-- Shop B (Pro): equal split of RM 10.00 three ways (334 + 333 + 333)
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-b')::uuid, 'role', 'authenticated')::text, true);
select is((select (t -> 'openTabs' -> 0 ->> 'totalSen')::int from jsonb_array_elements(public.get_tables_overview(md5('shop:b')::uuid)) t where t ->> 'label' = 'Table 1'), 1000, 'overview: open tab total');
insert into _r select 's1', public.record_payment((select id from _tab where k = 'b1'), 'cash', 334);
insert into _r select 's2', public.record_payment((select id from _tab where k = 'b1'), 'cash', 333);
select is((select r ->> 'remainingSen' from _r where k = 's1'), '666', 'first share leaves 666');
select is((select r ->> 'roundingSen' from _r where k = 's1'), '1', '334 rounds to 335 (+1)');
select is((select r ->> 'tabClosed' from _r where k = 's2'), 'false', 'second share: tab still open');
select is((select (t -> 'openTabs' -> 0 ->> 'paidSen')::int from jsonb_array_elements(public.get_tables_overview(md5('shop:b')::uuid)) t where t ->> 'label' = 'Table 1'), 667, 'overview: paid so far');
insert into _r select 's3', public.record_payment((select id from _tab where k = 'b1'), 'cash');
select is((select r - 'paymentId' from _r where k = 's3'), '{"amountSen": 333, "roundingSen": 2, "remainingSen": 0, "tabClosed": true}'::jsonb, 'last share closes the tab');
reset role;
select is((select paid_total_sen || '|' || rounding_sen from public.tabs where id = (select id from _tab where k = 'b1')), '1000|5', 'tab totals: 1000 paid, rounding 1 + 2 + 2');
set local role authenticated;
select is(jsonb_array_length(public.get_tab_detail((select id from _tab where k = 'b1')) -> 'payments'), 3, 'three payment rows');

-- By item (b2: nasi lemak 550, ayam goreng 500, extra kari 100)
select throws_ok($$select public.record_payment((select id from _tab where k = 'b2'), 'card', null, array[(select id from _ln where k = 'b3' and n = 1)])$$, 'P0001', 'invalid_input', 'a line of another tab: invalid_input');
select throws_ok($$select public.record_payment((select id from _tab where k = 'b2'), 'card', null, array[(select id from _ln where k = 'b2' and n = 1), '00000000-0000-0000-0000-000000000001'::uuid])$$, 'P0001', 'invalid_input', 'an unknown line: invalid_input');
select throws_ok($$select public.record_payment((select id from _tab where k = 'b2'), 'card', 5000)$$, 'P0001', 'invalid_input', 'B: amount above the balance: invalid_input');
insert into _r select 'i1', public.record_payment((select id from _tab where k = 'b2'), 'card', null, array[(select id from _ln where k = 'b2' and n = 1)]);
select is((select r - 'paymentId' from _r where k = 'i1'), '{"amountSen": 550, "roundingSen": 0, "remainingSen": 600, "tabClosed": false}'::jsonb, 'item split: the line total is the amount');
select is(public.get_tab_detail((select id from _tab where k = 'b2')) -> 'payments' -> 0 -> 'orderItemIds', jsonb_build_array((select id from _ln where k = 'b2' and n = 1)), 'payment lists its lines');
select is(public.get_tab_detail((select id from _tab where k = 'b2')) -> 'orders' -> 0 -> 'lines' -> 0 ->> 'paidPaymentId', (select r ->> 'paymentId' from _r where k = 'i1'), 'the line is marked paid');
select throws_ok($$select public.record_payment((select id from _tab where k = 'b2'), 'card', null, array[(select id from _ln where k = 'b2' and n = 1)])$$, 'P0001', 'invalid_input', 'a line already paid: invalid_input');
insert into _r select 'i2', public.record_payment((select id from _tab where k = 'b2'), 'card', null, array[(select id from _ln where k = 'b2' and n = 2), (select id from _ln where k = 'b2' and n = 3)]);
select is((select r - 'paymentId' from _r where k = 'i2'), '{"amountSen": 600, "roundingSen": 0, "remainingSen": 0, "tabClosed": true}'::jsonb, 'the last lines close the tab');

-- Mixed split: an amount payment, then an item split
insert into _r select 'm1', public.record_payment((select id from _tab where k = 'b3'), 'cash', 100);
select throws_ok($$select public.record_payment((select id from _tab where k = 'b3'), 'cash', null, array[(select id from _ln where k = 'b3' and n = 1)])$$, 'P0001', 'invalid_input', 'item split after an amount payment: invalid_input (mixed_split)');

-- Combo: pay the set line; a component line is refused
select throws_ok($$select public.record_payment((select id from _tab where k = 'b4'), 'cash', null, array[(select id from _ln where k = 'b4' and n = 2)])$$, 'P0001', 'invalid_input', 'a component line cannot be paid on its own: invalid_input');
insert into _r select 'c1', public.record_payment((select id from _tab where k = 'b4'), 'cash', null, array[(select id from _ln where k = 'b4' and n = 1)]);
select is((select r - 'paymentId' from _r where k = 'c1'), '{"amountSen": 700, "roundingSen": 0, "remainingSen": 0, "tabClosed": true}'::jsonb, 'set line: 700, tab closed');

select * from finish();
rollback;
