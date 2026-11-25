begin;
select plan(19);

create temp table _r (k text primary key, r jsonb);
grant all on _r to anon;
set local role anon;

select throws_ok($$select public.call_server('no-such-token-xxxxxxxxxxxxxxxx', 'bill')$$, 'P0001', 'not_found', 'unknown token: not_found');
select throws_ok($$select public.call_server('lapar-local-a-table-01', 'bogus')$$, '22P02', null, 'unknown reason is refused by the enum');
select throws_ok($$select public.call_server('lapar-local-a-table-01', null)$$, 'P0001', 'invalid_input', 'null reason: invalid_input');
select throws_ok($$select public.call_server('lapar-local-a-table-01', 'bill', repeat('x', 141))$$, 'P0001', 'invalid_input', 'note over 140 characters');

-- First tap, then a merge
insert into _r select 't1', public.call_server('lapar-local-a-table-01', 'bill');
select is(r ->> 'tapCount', '1', 'first tap: tapCount 1') from _r where k = 't1';
-- Taps within 10 s are ignored (migration 0800); make the last tap 11 s old so the next one counts.
reset role;
alter table public.service_requests disable trigger touch_updated_at;
update public.service_requests set updated_at = updated_at - interval '11 seconds' where true;
alter table public.service_requests enable trigger touch_updated_at;
set local role anon;
insert into _r select 't2', public.call_server('lapar-local-a-table-01', 'bill', '  cash please  ');
select is((select r ->> 'tapCount' from _r where k = 't2'), '2', 'second tap merges: tapCount 2');
select is((select r ->> 'requestId' from _r where k = 't2'), (select r ->> 'requestId' from _r where k = 't1'), 'second tap is the same request');
reset role;
alter table public.service_requests disable trigger touch_updated_at;
update public.service_requests set updated_at = updated_at - interval '11 seconds' where true;
alter table public.service_requests enable trigger touch_updated_at;
set local role anon;
insert into _r select 't3', public.call_server('lapar-local-a-table-01', 'bill', '   ');
select is((select r ->> 'tapCount' from _r where k = 't3'), '3', 'blank note still counts as a tap');

-- Stored state (read as postgres)
reset role;
create temp table _s as select reason, status, tap_count, note, tab_id from public.service_requests where table_id = md5('table:a:01')::uuid;
select is((select count(*) from _s), 1::bigint, 'one row for the merged call');
select is((select note from _s), 'cash please', 'note is trimmed and a later blank note does not erase it');
select is((select tab_id from _s), null, 'no open tab: tab_id null');

-- Acknowledged call is re-opened by a repeat tap
update public.service_requests set status = 'acknowledged', acknowledged_at = now() where table_id = md5('table:a:01')::uuid;
set local role anon;
insert into _r select 't4', public.call_server('lapar-local-a-table-01', 'bill');
reset role;
select is((select status::text || ',' || tap_count from public.service_requests where table_id = md5('table:a:01')::uuid), 'open,4', 'tap on an acknowledged call re-opens it');

-- A done call starts a new request; another reason and another table are separate
update public.service_requests set status = 'done', done_at = now() where table_id = md5('table:a:01')::uuid;
set local role anon;
insert into _r select 't5', public.call_server('lapar-local-a-table-01', 'bill');
select is((select r ->> 'tapCount' from _r where k = 't5'), '1', 'after done: a fresh request starts at 1');
select isnt((select r ->> 'requestId' from _r where k = 't5'), (select r ->> 'requestId' from _r where k = 't1'), 'after done: a new request id');
select is(public.call_server('lapar-local-a-table-01', 'water') ->> 'tapCount', '1', 'another reason is its own request');
select is(public.call_server('lapar-local-a-table-02', 'bill') ->> 'tapCount', '1', 'another table is its own request');

-- New calls link the open tab
insert into _r select 'order', public.place_order('lapar-local-a-table-03',
  jsonb_build_array(jsonb_build_object('itemId', md5('item:a:telur-mata')::uuid, 'qty', 1)));
insert into _r select 't6', public.call_server('lapar-local-a-table-03', 'other', 'napkins');
reset role;
select is((select tab_id from public.service_requests where id = (select (r ->> 'requestId')::uuid from _r where k = 't6')),
  (select (r ->> 'tabId')::uuid from _r where k = 'order'), 'new call links the table''s open tab');

-- Shop and feature gates
update public.shops set active = false where id = md5('shop:b')::uuid;
set local role anon;
select throws_ok($$select public.call_server('lapar-local-b-table-01', 'bill')$$, 'P0001', 'shop_inactive', 'inactive shop');
reset role;
update public.shops set active = true where id = md5('shop:b')::uuid;
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:b')::uuid, 'call_server', false, 'test');
set local role anon;
select throws_ok($$select public.call_server('lapar-local-b-table-01', 'bill')$$, 'P0001', 'feature_not_enabled', 'call_server feature off');

select * from finish();
rollback;
