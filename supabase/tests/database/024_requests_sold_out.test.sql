begin;
select plan(41);

create temp table _r (k text primary key, r jsonb);
grant all on _r to anon, authenticated;

insert into public.staff_sessions (auth_uid, shop_id, staff_id, expires_at) values
  (md5('user:device-a')::uuid, md5('shop:a')::uuid, md5('staff:a:aminah')::uuid, now() + interval '16 hours'),
  (md5('user:device-b')::uuid, md5('shop:b')::uuid, md5('staff:b:siti')::uuid, now() + interval '16 hours');
set local role anon;
insert into _r select 'bill', public.call_server('lapar-local-a-table-01', 'bill', 'cash');
insert into _r select 'water', public.call_server('lapar-local-a-table-02', 'water');
insert into _r select 'water2', public.call_server('lapar-local-a-table-02', 'water');
insert into _r select 'other', public.call_server('lapar-local-a-table-03', 'other', 'high chair');
insert into _r select 'b_bill', public.call_server('lapar-local-b-table-01', 'bill');
reset role;
update public.service_requests set created_at = now() - interval '3 minutes' where id = (select (r ->> 'requestId')::uuid from _r where k = 'bill');
update public.service_requests set created_at = now() - interval '2 minutes' where id = (select (r ->> 'requestId')::uuid from _r where k = 'water');
update public.service_requests set created_at = now() - interval '1 minute' where id = (select (r ->> 'requestId')::uuid from _r where k = 'other');

-- Callers
set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select public.get_service_requests(md5('shop:a')::uuid)$$, 'P0001', 'not_signed_in', 'get_service_requests without auth.uid(): not_signed_in');
select throws_ok($$select public.acknowledge_request((select (r ->> 'requestId')::uuid from _r where k = 'bill'))$$, 'P0001', 'not_signed_in', 'acknowledge_request without auth.uid(): not_signed_in');
select throws_ok($$select public.set_item_sold_out(md5('item:a:kopi')::uuid, true)$$, 'P0001', 'not_signed_in', 'set_item_sold_out without auth.uid(): not_signed_in');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:outsider')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.get_service_requests(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'outsider: get_service_requests forbidden');
select throws_ok($$select public.acknowledge_request((select (r ->> 'requestId')::uuid from _r where k = 'bill'))$$, 'P0001', 'forbidden', 'outsider: acknowledge_request forbidden');
select throws_ok($$select public.get_sold_out_items(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'outsider: get_sold_out_items forbidden');
select throws_ok($$select public.set_item_sold_out(md5('item:a:kopi')::uuid, true)$$, 'P0001', 'forbidden', 'outsider: set_item_sold_out forbidden');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-b')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.get_service_requests(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'staff of B: get_service_requests of A forbidden');
select throws_ok($$select public.acknowledge_request((select (r ->> 'requestId')::uuid from _r where k = 'bill'))$$, 'P0001', 'forbidden', 'staff of B: acknowledge an A request forbidden');
select throws_ok($$select public.complete_request((select (r ->> 'requestId')::uuid from _r where k = 'bill'))$$, 'P0001', 'forbidden', 'staff of B: complete an A request forbidden');
select throws_ok($$select public.get_sold_out_items(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'staff of B: get_sold_out_items of A forbidden');
select throws_ok($$select public.set_item_sold_out(md5('item:a:kopi')::uuid, true)$$, 'P0001', 'forbidden', 'staff of B: set_item_sold_out on an A item forbidden');

-- Listing (Aminah)
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select is((select string_agg(x ->> 'tableLabel' || ':' || (x ->> 'reason') || ':' || (x ->> 'tapCount'), ',' order by ord)
           from jsonb_array_elements(public.get_service_requests(md5('shop:a')::uuid)) with ordinality t (x, ord)),
  'Table 1:bill:1,Table 2:water:2,Table 3:other:1', 'A calls, oldest first, with table label, reason and tap count');
select is(public.get_service_requests(md5('shop:a')::uuid) -> 0 ->> 'note', 'cash', 'note is returned');
select is(public.get_service_requests(md5('shop:a')::uuid) -> 0 ->> 'status', 'open', 'new call is open');

-- Acknowledge, complete
select throws_ok($$select public.acknowledge_request('00000000-0000-0000-0000-000000000001')$$, 'P0001', 'not_found', 'unknown call: not_found');
select lives_ok($$select public.acknowledge_request((select (r ->> 'requestId')::uuid from _r where k = 'bill'))$$, 'acknowledge_request');
select is(public.get_service_requests(md5('shop:a')::uuid) -> 0 ->> 'status', 'acknowledged', 'status is acknowledged and the call is still listed');
select ok(public.get_service_requests(md5('shop:a')::uuid) -> 0 ->> 'acknowledgedAt' is not null, 'acknowledgedAt is set');
reset role;
update public.service_requests set acknowledged_at = now() - interval '1 hour' where id = (select (r ->> 'requestId')::uuid from _r where k = 'bill');
set local role authenticated;
select lives_ok($$select public.acknowledge_request((select (r ->> 'requestId')::uuid from _r where k = 'bill'))$$, 'acknowledging again is a no-op');
reset role;
select ok((select acknowledged_at < now() - interval '59 minutes' from public.service_requests where id = (select (r ->> 'requestId')::uuid from _r where k = 'bill')), 'the first acknowledgement time is kept');
set local role authenticated;
select lives_ok($$select public.complete_request((select (r ->> 'requestId')::uuid from _r where k = 'bill'))$$, 'complete_request');
select is(jsonb_array_length(public.get_service_requests(md5('shop:a')::uuid)), 2, 'a done call leaves the list');
reset role;
select ok((select done_at is not null and status = 'done' from public.service_requests where id = (select (r ->> 'requestId')::uuid from _r where k = 'bill')), 'done_at is set');
set local role authenticated;
select lives_ok($$select public.complete_request((select (r ->> 'requestId')::uuid from _r where k = 'bill'))$$, 'completing again is a no-op');
select throws_ok($$select public.acknowledge_request((select (r ->> 'requestId')::uuid from _r where k = 'bill'))$$, 'P0001', 'invalid_transition', 'acknowledging a done call: invalid_transition');
select lives_ok($$select public.complete_request((select (r ->> 'requestId')::uuid from _r where k = 'water'))$$, 'an open call can be completed directly');
-- A repeat tap on an acknowledged call re-opens it (D26)
select lives_ok($$select public.acknowledge_request((select (r ->> 'requestId')::uuid from _r where k = 'other'))$$, 'acknowledge other');
reset role;
set local role anon;
select is(public.call_server('lapar-local-a-table-03', 'other') ->> 'tapCount', '2', 'repeat tap on an acknowledged call');
reset role;
set local role authenticated;
select is(public.get_service_requests(md5('shop:a')::uuid) -> 0 ->> 'status', 'open', 'the repeat tap re-opened it for staff');

-- Staff of B see B's call
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-b')::uuid, 'role', 'authenticated')::text, true);
select is(jsonb_array_length(public.get_service_requests(md5('shop:b')::uuid)), 1, 'shop B has its own call');

-- Sold out
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
reset role;
update public.items set active = false where id = md5('item:a:sirap-bandung')::uuid;
set local role authenticated;
select is(jsonb_array_length(public.get_sold_out_items(md5('shop:a')::uuid)), 19, '19 active items listed (one is inactive)');
select is(public.get_sold_out_items(md5('shop:a')::uuid) -> 0 ->> 'categoryName', 'Drinks', 'by category sort: Drinks first');
select is(public.get_sold_out_items(md5('shop:a')::uuid) -> 0 ->> 'soldOut', 'false', 'nothing sold out yet');
select throws_ok($$select public.set_item_sold_out('00000000-0000-0000-0000-000000000001', true)$$, 'P0001', 'not_found', 'unknown item: not_found');
select throws_ok($$select public.set_item_sold_out(md5('item:a:kopi')::uuid, null)$$, 'P0001', 'invalid_input', 'null flag: invalid_input');
select lives_ok($$select public.set_item_sold_out(md5('item:a:kopi')::uuid, true)$$, 'staff sets an item sold out');
select is((select x ->> 'soldOut' from jsonb_array_elements(public.get_sold_out_items(md5('shop:a')::uuid)) x where x ->> 'name' = 'Kopi'), 'true', 'the list shows it');
set local role anon;
select throws_ok($$select public.place_order('lapar-local-a-table-05', jsonb_build_array(jsonb_build_object('itemId', md5('item:a:kopi')::uuid, 'qty', 1)))$$, 'P0001', 'sold_out', 'customers can no longer order it');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select lives_ok($$select public.set_item_sold_out(md5('item:a:kopi')::uuid, false)$$, 'the owner switches it back');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.set_item_sold_out(md5('item:a:kopi')::uuid, true)$$, 'P0001', 'forbidden', 'the owner of B cannot touch an A item');

select * from finish();
rollback;
