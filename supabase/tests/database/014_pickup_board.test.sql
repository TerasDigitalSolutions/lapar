begin;
select plan(14);

create temp table _r (k text primary key, r jsonb);
grant all on _r to anon;
set local role anon;

select throws_ok($$select public.get_pickup_board('no-such-board-token-xxxxxxxxxx')$$, 'P0001', 'not_found', 'unknown board token: not_found');
select throws_ok($$select public.get_pickup_board(null)$$, 'P0001', 'not_found', 'null board token: not_found');
select is(public.get_pickup_board('lapar-local-b-pickup-01') ->> 'shopName', 'Restoran Contoh', 'shop name');
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'preparing', '[]'::jsonb, 'nothing preparing yet');

-- Three counter orders (numbers 1..3); shop B auto-approves only after the first approval, so approve as postgres
reset role;
update public.shops set approval_mode = 'none' where id = md5('shop:b')::uuid;
set local role anon;
insert into _r select 'c1', public.place_order('lapar-local-b-counter-1', jsonb_build_array(jsonb_build_object('itemId', md5('item:b:telur-mata')::uuid, 'qty', 1)));
insert into _r select 'c2', public.place_order('lapar-local-b-counter-1', jsonb_build_array(
  jsonb_build_object('itemId', md5('item:b:set-a')::uuid, 'qty', 1)));
insert into _r select 'c3', public.place_order('lapar-local-b-counter-1', jsonb_build_array(jsonb_build_object('itemId', md5('item:b:ayam-goreng')::uuid, 'qty', 1)));
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'preparing', '[1, 2, 3]'::jsonb, 'new lines: all three are preparing, ascending');
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'ready', '[]'::jsonb, 'none ready yet');

-- Order 1 ready; order 2 has one component ready and one still cooking (stays preparing)
reset role;
update public.order_items set status = 'ready' where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'c1');
update public.order_items set status = 'ready' where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'c2') and kind = 'component' and line_no = 2;
update public.order_items set status = 'cooking' where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'c2') and kind = 'component' and line_no = 3;
set local role anon;
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'ready', '[1]'::jsonb, 'all lines ready: number 1 is ready');
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'preparing', '[2, 3]'::jsonb, 'a half-ready order stays in preparing (the set line itself is not a board line)');

-- Order 2 fully ready; order 1 served (leaves the board)
reset role;
update public.order_items set status = 'ready' where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'c2') and kind = 'component';
update public.order_items set status = 'served' where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'c1');
set local role anon;
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'ready', '[2]'::jsonb, 'order 2 ready, order 1 served and gone');
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'preparing', '[3]'::jsonb, 'order 3 still preparing');

-- Cancelled lines do not hold an order back
reset role;
update public.order_items set status = 'cancelled' where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'c3');
set local role anon;
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'preparing', '[]'::jsonb, 'all lines cancelled: leaves the board');

-- Pending-approval orders and yesterday's tabs stay off the board
reset role;
update public.shops set approval_mode = 'every_order' where id = md5('shop:b')::uuid;
set local role anon;
insert into _r select 'c4', public.place_order('lapar-local-b-counter-1', jsonb_build_array(jsonb_build_object('itemId', md5('item:b:telur-mata')::uuid, 'qty', 1)));
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'preparing', '[]'::jsonb, 'a pending order is not on the board');
reset role;
update public.tabs set opened_at = now() - interval '2 days' where id = (select (r ->> 'tabId')::uuid from _r where k = 'c2');
set local role anon;
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'ready', '[]'::jsonb, 'a tab from another day is not on the board');

-- Feature gate (the anon caller sees only numbers, never ids)
reset role;
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:b')::uuid, 'takeaway', false, 'test');
set local role anon;
select throws_ok($$select public.get_pickup_board('lapar-local-b-pickup-01')$$, 'P0001', 'feature_not_enabled', 'takeaway turned off: feature_not_enabled');

select * from finish();
rollback;
