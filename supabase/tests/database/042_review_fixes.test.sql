begin;
select plan(16);

create temp table _r (k text primary key, r jsonb);
grant all on _r to anon;

-- 1. Pickup board: a paid counter tab stays until everything is served -----------------------------------
update public.shops set approval_mode = 'none' where id = md5('shop:b')::uuid;
set local role anon;
insert into _r select 'c1', public.place_order('lapar-local-b-counter-1', jsonb_build_array(
  jsonb_build_object('itemId', md5('item:b:telur-mata')::uuid, 'qty', 1), jsonb_build_object('itemId', md5('item:b:ayam-goreng')::uuid, 'qty', 1)));
reset role;
update public.tabs set status = 'closed', closed_at = now(), paid_total_sen = 0 where id = (select (r ->> 'tabId')::uuid from _r where k = 'c1');
set local role anon;
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'preparing', '[1]'::jsonb, 'paid tab, food not made: still preparing');
reset role;
update public.order_items set status = 'ready' where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'c1') and line_no = 1;
set local role anon;
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'preparing', '[1]'::jsonb, 'paid tab, one line not ready: preparing');
reset role;
update public.order_items set status = 'ready' where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'c1');
set local role anon;
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'ready', '[1]'::jsonb, 'paid tab, all ready: ready');
reset role;
update public.order_items set status = 'served' where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'c1');
set local role anon;
select is(public.get_pickup_board('lapar-local-b-pickup-01') -> 'ready', '[]'::jsonb, 'all served: number gone');

-- 2. Stale table tab --------------------------------------------------------------------------------------
reset role;
update public.shops set approval_mode = 'first_order' where id = md5('shop:b')::uuid;
set local role anon;
insert into _r select 't1', public.place_order('lapar-local-b-table-02', jsonb_build_array(jsonb_build_object('itemId', md5('item:b:telur-mata')::uuid, 'qty', 1)));
reset role;
update public.orders set status = 'approved', approved_at = now() where id = (select (r ->> 'orderId')::uuid from _r where k = 't1');
update public.tabs set opened_at = now() - interval '2 days' where id = (select (r ->> 'tabId')::uuid from _r where k = 't1');
set local role anon;
select is(public.get_tab('lapar-local-b-table-02') -> 'tab', 'null'::jsonb, 'a tab opened before today is not shown');
insert into _r select 't2', public.place_order('lapar-local-b-table-02', jsonb_build_array(jsonb_build_object('itemId', md5('item:b:telur-mata')::uuid, 'qty', 1)));
select isnt((select r ->> 'tabId' from _r where k = 't2'), (select r ->> 'tabId' from _r where k = 't1'), 'a fresh tab is opened');
select is((select r ->> 'status' from _r where k = 't2'), 'pending_approval', 'first-order approval applies again');
reset role;
select is((select status::text || ',' || (closed_at is not null) || ',' || coalesce(paid_total_sen::text, 'null') from public.tabs
  where id = (select (r ->> 'tabId')::uuid from _r where k = 't1')), 'closed,true,null', 'stale tab closed, nothing paid');
select is((select count(*) from public.tabs where table_id = md5('table:b:02')::uuid and status = 'open'), 1::bigint, 'one open tab');

-- 3. call_server throttle -----------------------------------------------------------------------------------
set local role anon;
insert into _r select 'k1', public.call_server('lapar-local-b-table-03', 'water');
insert into _r select 'k2', public.call_server('lapar-local-b-table-03', 'water', 'ice');
select is((select r ->> 'tapCount' from _r where k = 'k2'), '1', 'a tap within 10 seconds returns the call unchanged');
select is((select r ->> 'requestId' from _r where k = 'k2'), (select r ->> 'requestId' from _r where k = 'k1'), 'same request returned');
reset role;
select is((select note from public.service_requests where table_id = md5('table:b:03')::uuid), null, 'throttled tap changed nothing');
alter table public.service_requests disable trigger touch_updated_at; -- the touch trigger would reset updated_at
update public.service_requests set updated_at = now() - interval '11 seconds' where table_id = md5('table:b:03')::uuid;
set local role anon;
insert into _r select 'k3', public.call_server('lapar-local-b-table-03', 'water');
select is((select r ->> 'tapCount' from _r where k = 'k3'), '2', 'after 10 seconds a tap counts');

-- 4. Set meal with no components ----------------------------------------------------------------------------
reset role;
delete from public.combo_components where combo_item_id = md5('item:b:set-a')::uuid;
set local role anon;
select throws_ok($$select public.place_order('lapar-local-b-table-04', jsonb_build_array(jsonb_build_object('itemId', md5('item:b:set-a')::uuid, 'qty', 1)))$$,
  'P0001', 'item_unavailable', 'set with no components: item_unavailable');

-- 5. Overnight promo endsAt ---------------------------------------------------------------------------------
reset role;
update public.promos set start_time = '00:01', end_time = '00:00' where id = md5('promo:b:happy-hour')::uuid; -- all day but 00:00
set local role anon;
select is((jsonb_path_query_first(public.get_menu('lapar-local-b-table-01'), '$.items[*] ? (@.name == "Teh tarik")') #>> '{promo,endsAt}')::timestamptz,
  ((now() at time zone 'Asia/Kuala_Lumpur')::date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur',
  'before midnight (after the start): ends tomorrow');
reset role;
update public.promos set start_time = '23:59', end_time = '23:58' where id = md5('promo:b:happy-hour')::uuid; -- all day but 23:58
set local role anon;
select is((jsonb_path_query_first(public.get_menu('lapar-local-b-table-01'), '$.items[*] ? (@.name == "Teh tarik")') #>> '{promo,endsAt}')::timestamptz,
  ((now() at time zone 'Asia/Kuala_Lumpur')::date + time '23:58') at time zone 'Asia/Kuala_Lumpur',
  'after midnight (before the end): ends today');

select * from finish();
rollback;
