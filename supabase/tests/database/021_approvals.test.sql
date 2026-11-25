begin;
select plan(30);

create temp table _r (k text primary key, r jsonb);
grant all on _r to anon, authenticated;

-- Fixtures: every order needs approval; device-a is Aminah (shop A), device-b is Siti (shop B)
update public.shops set approval_mode = 'every_order';
insert into public.staff_sessions (auth_uid, shop_id, staff_id, expires_at) values
  (md5('user:device-a')::uuid, md5('shop:a')::uuid, md5('staff:a:aminah')::uuid, now() + interval '16 hours'),
  (md5('user:device-b')::uuid, md5('shop:b')::uuid, md5('staff:b:siti')::uuid, now() + interval '16 hours');
set local role anon;
insert into _r select 'o1', public.place_order('lapar-local-a-table-01', jsonb_build_array(
  jsonb_build_object('itemId', md5('item:a:telur-mata')::uuid, 'qty', 2), jsonb_build_object('itemId', md5('item:a:ayam-goreng')::uuid, 'qty', 1)));
insert into _r select 'o2', public.place_order('lapar-local-a-table-02', jsonb_build_array(jsonb_build_object('itemId', md5('item:a:kaya-toast')::uuid, 'qty', 1)));
insert into _r select 'o3', public.place_order('lapar-local-a-table-03', jsonb_build_array(jsonb_build_object('itemId', md5('item:a:telur-mata')::uuid, 'qty', 1)));
insert into _r select 'o4', public.place_order('lapar-local-a-table-04', jsonb_build_array(jsonb_build_object('itemId', md5('item:a:telur-mata')::uuid, 'qty', 1)));
insert into _r select 'b1', public.place_order('lapar-local-b-table-01', jsonb_build_array(jsonb_build_object('itemId', md5('item:b:telur-mata')::uuid, 'qty', 1)));
reset role;
update public.orders set created_at = now() - interval '10 minutes' where id = (select (r ->> 'orderId')::uuid from _r where k = 'o1');

-- Callers
set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select public.get_pending_orders(md5('shop:a')::uuid)$$, 'P0001', 'not_signed_in', 'get_pending_orders without auth.uid(): not_signed_in');
select throws_ok(format($$select public.approve_order(%L)$$, (select r ->> 'orderId' from _r where k = 'o1')), 'P0001', 'not_signed_in', 'approve_order without auth.uid(): not_signed_in');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:outsider')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.get_pending_orders(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'outsider: get_pending_orders forbidden');
select throws_ok(format($$select public.approve_order(%L)$$, (select r ->> 'orderId' from _r where k = 'o1')), 'P0001', 'forbidden', 'outsider: approve_order forbidden');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-b')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.get_pending_orders(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'staff of B: get_pending_orders of A forbidden');
select throws_ok(format($$select public.approve_order(%L)$$, (select r ->> 'orderId' from _r where k = 'o1')), 'P0001', 'forbidden', 'staff of B: approve_order of an A order forbidden');
select throws_ok(format($$select public.reject_order(%L, 'no')$$, (select r ->> 'orderId' from _r where k = 'o1')), 'P0001', 'forbidden', 'staff of B: reject_order of an A order forbidden');
select throws_ok($$select public.approve_order('00000000-0000-0000-0000-000000000001')$$, 'P0001', 'not_found', 'unknown order: not_found');

-- Listing (device-a = Aminah)
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select is(jsonb_array_length(public.get_pending_orders(md5('shop:a')::uuid)), 4, 'four pending orders in shop A');
select is(public.get_pending_orders(md5('shop:a')::uuid) -> 0 ->> 'tableLabel', 'Table 1', 'oldest first, with the table label');
select is((public.get_pending_orders(md5('shop:a')::uuid) -> 0 ->> 'totalSen')::int, 740, 'order total 2 x 120 + 500');
select is(jsonb_array_length(public.get_pending_orders(md5('shop:a')::uuid) -> 0 -> 'lines'), 2, 'lines are listed');
select is(public.get_pending_orders(md5('shop:a')::uuid) -> 0 -> 'lines' -> 0 ->> 'status', 'pending', 'lines are pending');
select is(public.get_pending_orders(md5('shop:a')::uuid) -> 0 -> 'lines' -> 0 ->> 'name', 'Telur mata', 'lines follow line_no');

-- Approve
select lives_ok(format($$select public.approve_order(%L)$$, (select r ->> 'orderId' from _r where k = 'o1')), 'approve_order');
reset role;
select is((select status::text from public.orders where id = (select (r ->> 'orderId')::uuid from _r where k = 'o1')), 'approved', 'order is approved');
select is((select approved_by_staff_id from public.orders where id = (select (r ->> 'orderId')::uuid from _r where k = 'o1')), md5('staff:a:aminah')::uuid, 'approved_by_staff_id is the staff member');
select ok((select approved_at is not null from public.orders where id = (select (r ->> 'orderId')::uuid from _r where k = 'o1')), 'approved_at is set');
select is((select array_agg(distinct status::text) from public.order_items where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'o1')), array['new'], 'lines are new');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select is(jsonb_array_length(public.get_pending_orders(md5('shop:a')::uuid)), 3, 'an approved order leaves the pending list');
select throws_ok(format($$select public.approve_order(%L)$$, (select r ->> 'orderId' from _r where k = 'o1')), 'P0001', 'invalid_transition', 'approving twice: invalid_transition');
select throws_ok(format($$select public.reject_order(%L, 'too late')$$, (select r ->> 'orderId' from _r where k = 'o1')), 'P0001', 'invalid_transition', 'rejecting an approved order: invalid_transition');

-- Reject
select throws_ok(format($$select public.reject_order(%L, '   ')$$, (select r ->> 'orderId' from _r where k = 'o2')), 'P0001', 'invalid_input', 'blank reason: invalid_input');
select throws_ok(format($$select public.reject_order(%L, %L)$$, (select r ->> 'orderId' from _r where k = 'o2'), repeat('x', 141)), 'P0001', 'invalid_input', 'reason over 140: invalid_input');
select lives_ok(format($$select public.reject_order(%L, '  Out of kaya  ')$$, (select r ->> 'orderId' from _r where k = 'o2')), 'reject_order');
reset role;
select is((select status::text || '|' || rejected_reason from public.orders where id = (select (r ->> 'orderId')::uuid from _r where k = 'o2')), 'rejected|Out of kaya', 'rejected with the trimmed reason');
select is((select array_agg(distinct status::text) from public.order_items where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'o2')), array['cancelled'], 'rejected order lines are cancelled');

-- Closed tab
update public.tabs set status = 'closed', closed_at = now() where id = (select (r ->> 'tabId')::uuid from _r where k = 'o3');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select throws_ok(format($$select public.approve_order(%L)$$, (select r ->> 'orderId' from _r where k = 'o3')), 'P0001', 'tab_closed', 'approving on a closed tab: tab_closed');

-- Owner approves: approved_by_staff_id stays null
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select lives_ok(format($$select public.approve_order(%L)$$, (select r ->> 'orderId' from _r where k = 'o4')), 'owner can approve');
reset role;
select is((select approved_by_staff_id from public.orders where id = (select (r ->> 'orderId')::uuid from _r where k = 'o4')), null::uuid, 'owner approval: approved_by_staff_id is null');

select * from finish();
rollback;
