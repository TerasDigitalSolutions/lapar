begin;
select plan(23);

-- Orders go in as anon through the RPC; approvals, payments and clock moves are done as postgres.
create temp table _r (k text primary key, r jsonb);
grant all on _r to anon;
update public.shops set approval_mode = 'every_order' where id = md5('shop:a')::uuid;

set local role anon;
select throws_ok($$select public.get_tab('no-such-token-xxxxxxxxxxxxxxxx')$$, 'P0001', 'not_found', 'unknown token: not_found');

-- Empty table: no tab yet
select is(public.get_tab('lapar-local-a-table-01') -> 'tab', 'null'::jsonb, 'no open tab: tab is null');
select is(public.get_tab('lapar-local-a-table-01') -> 'orders', '[]'::jsonb, 'no open tab: orders is []');

-- Table A1: two orders, one gets approved
insert into _r select 'o1', public.place_order('lapar-local-a-table-01',
  jsonb_build_array(jsonb_build_object('itemId', md5('item:a:kopi')::uuid, 'qty', 1, 'optionIds', jsonb_build_array(md5('option:a:kopi:panas')::uuid))));
insert into _r select 'o2', public.place_order('lapar-local-a-table-01',
  jsonb_build_array(jsonb_build_object('itemId', md5('item:a:teh-tarik')::uuid, 'qty', 1, 'optionIds', jsonb_build_array(md5('option:a:teh-tarik:panas')::uuid))));
-- Table A2: one order of its own
insert into _r select 'o3', public.place_order('lapar-local-a-table-02',
  jsonb_build_array(jsonb_build_object('itemId', md5('item:a:nasi-lemak')::uuid, 'qty', 1)));

reset role;
update public.orders set created_at = now() - interval '1 minute' where id = (select (r ->> 'orderId')::uuid from _r where k = 'o1');
set local role anon;
select is(jsonb_array_length(public.get_tab('lapar-local-a-table-01') -> 'orders'), 2, 'A1 sees its two orders');
select is(jsonb_array_length(public.get_tab('lapar-local-a-table-02') -> 'orders'), 1, 'A2 sees only its own order');
select is((select count(*) from jsonb_path_query(public.get_tab('lapar-local-a-table-01'), '$.orders[*].lines[*] ? (@.name == "Nasi lemak")')),
  0::bigint, 'A1 token never shows the A2 tab');
select is(public.get_tab('lapar-local-a-table-01', (select (r ->> 'tabId')::uuid from _r where k = 'o3')) #>> '{tab,id}',
  (select r ->> 'tabId' from _r where k = 'o1'), 'a table token ignores p_tab_id (A2 tab id still returns the A1 tab)');
select is(public.get_tab('lapar-local-a-table-01') #>> '{orders,0,lines,0,name}', 'Kopi', 'orders oldest first, lines by line_no');

-- Totals split approved / pending
select is((public.get_tab('lapar-local-a-table-01') #>> '{tab,totalSen}') || ',' || (public.get_tab('lapar-local-a-table-01') #>> '{tab,pendingSen}'),
  '0,420', 'both orders waiting: pending 200 + 220');
reset role;
update public.orders set status = 'approved', approved_at = now() where id = (select (r ->> 'orderId')::uuid from _r where k = 'o1');
update public.order_items set status = 'new' where order_id = (select (r ->> 'orderId')::uuid from _r where k = 'o1');
insert into public.tab_payments (shop_id, tab_id, method, amount_sen)
  values (md5('shop:a')::uuid, (select (r ->> 'tabId')::uuid from _r where k = 'o1'), 'cash', 50);
set local role anon;
select is((public.get_tab('lapar-local-a-table-01') #>> '{tab,totalSen}') || ',' || (public.get_tab('lapar-local-a-table-01') #>> '{tab,pendingSen}')
  || ',' || (public.get_tab('lapar-local-a-table-01') #>> '{tab,paidSen}'), '200,220,50', 'total 200 approved, 220 pending, 50 paid');
select is(public.get_tab('lapar-local-a-table-01') #>> '{orders,0,lines,0,status}', 'new', 'line status shown');
select is(public.get_tab('lapar-local-a-table-01') #>> '{orders,1,status}', 'pending_approval', 'order status shown');

-- Rejected orders keep their reason and stay out of the totals
reset role;
update public.orders set status = 'rejected', rejected_reason = 'Kitchen closed'
  where id = (select (r ->> 'orderId')::uuid from _r where k = 'o2');
set local role anon;
select is(public.get_tab('lapar-local-a-table-01') #>> '{orders,1,rejectedReason}', 'Kitchen closed', 'rejected reason shown');
select is(public.get_tab('lapar-local-a-table-01') #>> '{tab,pendingSen}', '0', 'rejected orders are not pending');

-- Open service calls show up
select public.call_server('lapar-local-a-table-01', 'bill');
select is(public.get_tab('lapar-local-a-table-01') #>> '{openRequests,0,reason}', 'bill', 'open call listed');
select is(jsonb_array_length(public.get_tab('lapar-local-a-table-02') -> 'openRequests'), 0, 'calls of another table are not listed');

-- Sets: components follow their set, are never charged
insert into _r select 's1', public.place_order('lapar-local-b-table-01',
  jsonb_build_array(jsonb_build_object('itemId', md5('item:b:set-a')::uuid, 'qty', 1)));
select is((public.get_tab('lapar-local-b-table-01') #>> '{orders,0,lines,1,parentLineId}'), public.get_tab('lapar-local-b-table-01') #>> '{orders,0,lines,0,id}',
  'component points at its set line');
select is(public.get_tab('lapar-local-b-table-01') #>> '{tab,pendingSen}', '700', 'pending counts the set once, not its components');

-- Counter tokens need their own tab id
insert into _r select 'c1', public.place_order('lapar-local-b-counter-1',
  jsonb_build_array(jsonb_build_object('itemId', md5('item:b:telur-mata')::uuid, 'qty', 1)));
select throws_ok($$select public.get_tab('lapar-local-b-counter-1')$$, 'P0001', 'invalid_input', 'counter without p_tab_id: invalid_input');
select throws_ok($$select public.get_tab('lapar-local-b-counter-1', (select (r ->> 'tabId')::uuid from _r where k = 's1'))$$, 'P0001', 'not_found',
  'counter token with a table tab id: not_found');
select is(public.get_tab('lapar-local-b-counter-1', (select (r ->> 'tabId')::uuid from _r where k = 'c1')) #>> '{tab,pickupNo}', '1', 'counter tab with its own id returns the pickup number');
reset role;
update public.tabs set status = 'closed', closed_at = now() where id = (select (r ->> 'tabId')::uuid from _r where k = 'c1');
set local role anon;
select is(public.get_tab('lapar-local-b-counter-1', (select (r ->> 'tabId')::uuid from _r where k = 'c1')) #>> '{tab,status}', 'closed', 'closed counter tab still returned');
reset role;
update public.tabs set opened_at = now() - interval '25 hours' where id = (select (r ->> 'tabId')::uuid from _r where k = 'c1');
set local role anon;
select throws_ok($$select public.get_tab('lapar-local-b-counter-1', (select (r ->> 'tabId')::uuid from _r where k = 'c1'))$$, 'P0001', 'not_found',
  'counter tab older than 24 h: not_found');

select * from finish();
rollback;
