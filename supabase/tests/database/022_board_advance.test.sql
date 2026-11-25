begin;
select plan(63);

create temp table _r (k text primary key, r jsonb);
create temp table _m (f text, t text, res text);
grant all on _r to anon, authenticated;

-- Fixtures: shops approve nothing, except one pending A order placed last
update public.shops set approval_mode = 'none';
insert into public.staff_sessions (auth_uid, shop_id, staff_id, expires_at) values
  (md5('user:device-a')::uuid, md5('shop:a')::uuid, md5('staff:a:aminah')::uuid, now() + interval '16 hours'),
  (md5('user:device-b')::uuid, md5('shop:b')::uuid, md5('staff:b:siti')::uuid, now() + interval '16 hours');
set local role anon;
insert into _r select 'a1', public.place_order('lapar-local-a-table-01', jsonb_build_array(
  jsonb_build_object('itemId', md5('item:a:telur-mata')::uuid, 'qty', 1),
  jsonb_build_object('itemId', md5('item:a:ayam-goreng')::uuid, 'qty', 2),
  jsonb_build_object('itemId', md5('item:a:kaya-toast')::uuid, 'qty', 1)));
insert into _r select 'b1', public.place_order('lapar-local-b-table-01', jsonb_build_array(
  jsonb_build_object('itemId', md5('item:b:nasi-lemak')::uuid, 'qty', 1),
  jsonb_build_object('itemId', md5('item:b:teh-tarik')::uuid, 'qty', 1, 'optionIds', jsonb_build_array(md5('option:b:teh-tarik:panas')::uuid))));
insert into _r select 'b2', public.place_order('lapar-local-b-table-02', jsonb_build_array(jsonb_build_object('itemId', md5('item:b:set-a')::uuid, 'qty', 1)));
reset role;
update public.shops set approval_mode = 'every_order' where id = md5('shop:a')::uuid;
set local role anon;
insert into _r select 'a2', public.place_order('lapar-local-a-table-02', jsonb_build_array(jsonb_build_object('itemId', md5('item:a:telur-mata')::uuid, 'qty', 1)));
reset role;
-- Distinct, ordered approval times (A order first)
update public.orders set approved_at = now() - interval '9 minutes' where id = (select (r ->> 'orderId')::uuid from _r where k = 'b1');
update public.orders set approved_at = now() - interval '8 minutes' where id = (select (r ->> 'orderId')::uuid from _r where k = 'b2');

-- The whole transition matrix, as Aminah (claims set on the postgres session; advance_item is security definer)
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
create function pg_temp.try_move(p_line uuid, p_from public.item_status, p_to public.item_status) returns text
language plpgsql as $$
begin
  update public.order_items set status = p_from, column_id = null where id = p_line;
  begin
    perform public.advance_item(p_line, p_to);
    return 'ok';
  exception when others then return sqlerrm;
  end;
end $$;
insert into _m select f::text, t::text, pg_temp.try_move((select (r -> 'lines' -> 0 ->> 'lineId')::uuid from _r where k = 'a1'), f, t)
from unnest(enum_range(null::public.item_status)) f, unnest(enum_range(null::public.item_status)) t;
select is((select count(*) from _m), 49::bigint, 'matrix covers 7 x 7 pairs');
select is((select array_agg(f || '>' || t order by f, t) from _m where res = 'ok'),
  array['cooking>cancelled', 'cooking>preparing', 'cooking>ready', 'new>cancelled', 'new>preparing', 'preparing>cancelled',
        'preparing>cooking', 'preparing>new', 'ready>cancelled', 'ready>cooking', 'ready>served'],
  'exactly the eleven allowed moves succeed');
select is((select count(*) from _m where res not in ('ok', 'invalid_transition')), 0::bigint, 'every other pair is invalid_transition');
select is((select res from _m where f = 'new' and t = 'new'), 'invalid_transition', 'same status without a column: invalid_transition');
select is((select res from _m where f = 'pending' and t = 'new'), 'invalid_transition', 'pending -> new is not a staff move (approval does that)');
select is((select res from _m where f = 'served' and t = 'ready'), 'invalid_transition', 'served is final');
select is((select res from _m where f = 'cancelled' and t = 'new'), 'invalid_transition', 'cancelled is final');
update public.order_items set status = 'new', column_id = null, ready_at = null, served_at = null where id = (select (r -> 'lines' -> 0 ->> 'lineId')::uuid from _r where k = 'a1');

-- Callers
set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select throws_ok(format($$select public.advance_item(%L, 'preparing')$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'a1')), 'P0001', 'not_signed_in', 'advance_item without auth.uid(): not_signed_in');
select throws_ok($$select public.get_board(md5('shop:a')::uuid)$$, 'P0001', 'not_signed_in', 'get_board without auth.uid(): not_signed_in');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:outsider')::uuid, 'role', 'authenticated')::text, true);
select throws_ok(format($$select public.advance_item(%L, 'preparing')$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'a1')), 'P0001', 'forbidden', 'outsider: advance_item forbidden');
select throws_ok($$select public.get_board(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'outsider: get_board forbidden');
select throws_ok($$select public.get_stations(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'outsider: get_stations forbidden');
select throws_ok($$select public.get_ready_lines(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'outsider: get_ready_lines forbidden');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-b')::uuid, 'role', 'authenticated')::text, true);
select throws_ok(format($$select public.advance_item(%L, 'preparing')$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'a1')), 'P0001', 'forbidden', 'staff of B: advance_item on an A line forbidden');
select throws_ok($$select public.get_board(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'staff of B: get_board of A forbidden');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.advance_item('00000000-0000-0000-0000-000000000001', 'preparing')$$, 'P0001', 'not_found', 'unknown line: not_found');

-- Shop A board: fixed columns, three lines of the approved order, positions 1..3 of 3; the pending order is absent
select is(jsonb_array_length(public.get_board(md5('shop:a')::uuid) -> 'columns'), 4, 'A: four fixed columns');
select is(public.get_board(md5('shop:a')::uuid) -> 'columns' -> 0, '{"id": null, "name": null, "coreStatus": "new", "sort": 0}'::jsonb, 'A: first fixed column is null id, null name, core new');
select is(public.get_board(md5('shop:a')::uuid) -> 'columns' -> 3 ->> 'coreStatus', 'ready', 'A: last fixed column is ready');
select is(public.get_board(md5('shop:a')::uuid) ->> 'stationName', 'Kitchen', 'null station = the default station');
select is(jsonb_array_length(public.get_board(md5('shop:a')::uuid) -> 'lines'), 3, 'A: three lines (pending order not shown)');
select is((select string_agg((l ->> 'position') || 'of' || (l ->> 'positionOf'), ',' order by (l ->> 'position')::int)
           from jsonb_array_elements(public.get_board(md5('shop:a')::uuid) -> 'lines') l), '1of3,2of3,3of3', 'positions n of m');
select is(public.get_board(md5('shop:a')::uuid) -> 'lines' -> 0 ->> 'tableLabel', 'Table 1', 'line carries the table label');
select throws_ok($$select public.get_board(md5('shop:a')::uuid, md5('station:b:kitchen')::uuid)$$, 'P0001', 'not_found', 'a station of another shop: not_found');
select is(jsonb_array_length(public.get_stations(md5('shop:a')::uuid)), 1, 'A has one active station');

-- Basic shop with a stray custom column row: still the fixed columns
reset role;
insert into public.board_columns (shop_id, station_id, name, core_status, sort) values (md5('shop:a')::uuid, md5('station:a:kitchen')::uuid, 'Stray', 'new', 0);
set local role authenticated;
select is(jsonb_array_length(public.get_board(md5('shop:a')::uuid) -> 'columns'), 4, 'A: custom_columns off, so columns stay fixed');
select is(public.get_board(md5('shop:a')::uuid) -> 'columns' -> 0 -> 'id', 'null'::jsonb, 'A: fixed columns have no id');

-- Moves on A: timestamps, column refused, cancel drops positions
select lives_ok(format($$select public.advance_item(%L, 'preparing')$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'a1')), 'new -> preparing');
select lives_ok(format($$select public.advance_item(%L, 'cooking')$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'a1')), 'preparing -> cooking');
reset role;
select is((select ready_at from public.order_items where id = (select (r -> 'lines' -> 0 ->> 'lineId')::uuid from _r where k = 'a1')), null::timestamptz, 'ready_at not set before ready');
set local role authenticated;
select lives_ok(format($$select public.advance_item(%L, 'ready')$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'a1')), 'cooking -> ready');
select lives_ok(format($$select public.advance_item(%L, 'cancelled')$$, (select r -> 'lines' -> 1 ->> 'lineId' from _r where k = 'a1')), 'new -> cancelled');
select is((select string_agg((l ->> 'position') || 'of' || (l ->> 'positionOf'), ',' order by (l ->> 'position')::int)
           from jsonb_array_elements(public.get_board(md5('shop:a')::uuid) -> 'lines') l), '1of2,2of2', 'a cancelled line leaves the board and the count');
select is(public.get_ready_lines(md5('shop:a')::uuid) -> 0 ->> 'name', 'Telur mata', 'ready line is in get_ready_lines');
select throws_ok(format($$select public.advance_item(%L, 'cooking', %L)$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'a1'), md5('x')::uuid),
  'P0001', 'feature_not_enabled', 'a column on a Basic shop: feature_not_enabled');
select throws_ok(format($$select public.advance_item(%L, 'ready')$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'a1')), 'P0001', 'invalid_transition', 'same status without a column: invalid_transition');
select lives_ok(format($$select public.advance_item(%L, 'served')$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'a1')), 'ready -> served');
reset role;
select ok((select ready_at is not null and served_at is not null and status = 'served' from public.order_items where id = (select (r -> 'lines' -> 0 ->> 'lineId')::uuid from _r where k = 'a1')), 'ready_at and served_at are set');
set local role authenticated;
select is(jsonb_array_length(public.get_ready_lines(md5('shop:a')::uuid)), 0, 'a served line leaves the to-serve list');
select is(jsonb_array_length(public.get_board(md5('shop:a')::uuid) -> 'lines'), 1, 'served and cancelled lines are off the board');

-- A line of a pending order cannot move
select throws_ok(format($$select public.advance_item(%L, 'preparing')$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'a2')), 'P0001', 'invalid_transition', 'order not approved: invalid_transition');

-- Shop B: stations, filters, combos, custom columns
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-b')::uuid, 'role', 'authenticated')::text, true);
select is((select string_agg(s ->> 'name', ',' order by (s ->> 'sort')::int) from jsonb_array_elements(public.get_stations(md5('shop:b')::uuid)) s), 'Kitchen,Drinks', 'B stations by sort');
select is((select string_agg(l ->> 'name', ',' order by l ->> 'name') from jsonb_array_elements(public.get_board(md5('shop:b')::uuid) -> 'lines') l),
  'Nasi lemak,Nasi lemak', 'default station = Kitchen: nasi lemak and the set component');
select is((select string_agg(l ->> 'name', ',' order by l ->> 'name') from jsonb_array_elements(public.get_board(md5('shop:b')::uuid, md5('station:b:drinks')::uuid) -> 'lines') l),
  'Teh tarik,Teh tarik', 'Drinks station filter: teh tarik and the set component');
select is((select l ->> 'parentName' from jsonb_array_elements(public.get_board(md5('shop:b')::uuid, md5('station:b:drinks')::uuid) -> 'lines') l where l ->> 'kind' = 'component'),
  'Set A', 'component carries the set name as parentName');
select is((select (l ->> 'position') || 'of' || (l ->> 'positionOf') from jsonb_array_elements(public.get_board(md5('shop:b')::uuid, md5('station:b:drinks')::uuid) -> 'lines') l where l ->> 'kind' = 'component'),
  '2of2', 'set order: the combo line does not count, so components are 1 of 2 and 2 of 2');
select is((select l ->> 'name' from jsonb_array_elements(public.get_board(md5('shop:b')::uuid) -> 'lines') l order by l ->> 'approvedAt' limit 1), 'Nasi lemak', 'oldest approval first');
select throws_ok(format($$select public.advance_item(%L, 'preparing')$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'b2')), 'P0001', 'invalid_transition', 'a set (combo) line cannot move');

reset role;
insert into public.board_columns (id, shop_id, station_id, name, core_status, sort) values
  (md5('col:b:queue')::uuid, md5('shop:b')::uuid, md5('station:b:kitchen')::uuid, 'Queue', 'new', 0),
  (md5('col:b:prep')::uuid, md5('shop:b')::uuid, md5('station:b:kitchen')::uuid, 'Prep', 'preparing', 1),
  (md5('col:b:grill')::uuid, md5('shop:b')::uuid, md5('station:b:kitchen')::uuid, 'Grill', 'cooking', 2),
  (md5('col:b:wok')::uuid, md5('shop:b')::uuid, md5('station:b:kitchen')::uuid, 'Wok', 'cooking', 3),
  (md5('col:b:pass')::uuid, md5('shop:b')::uuid, md5('station:b:kitchen')::uuid, 'Pass', 'ready', 4),
  (md5('col:b:dcool')::uuid, md5('shop:b')::uuid, md5('station:b:drinks')::uuid, 'Cooling', 'cooking', 0);
set local role authenticated;
select is((select string_agg(c ->> 'name', ',' order by (c ->> 'sort')::int) from jsonb_array_elements(public.get_board(md5('shop:b')::uuid, md5('station:b:kitchen')::uuid) -> 'columns') c),
  'Queue,Prep,Grill,Wok,Pass', 'B: custom columns by sort');
select is(public.get_board(md5('shop:b')::uuid, md5('station:b:kitchen')::uuid) -> 'columns' -> 3 ->> 'id', md5('col:b:wok')::uuid::text, 'custom columns carry their id');
select is(jsonb_array_length(public.get_board(md5('shop:b')::uuid, md5('station:b:drinks')::uuid) -> 'columns'), 1, 'a station with its own rows shows only those');

-- Move the Kitchen nasi lemak line (b1, line 1) with columns
select lives_ok(format($$select public.advance_item(%L, 'preparing', %L)$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'b1'), md5('col:b:prep')::uuid), 'new -> preparing into column Prep');
select lives_ok(format($$select public.advance_item(%L, 'cooking', %L)$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'b1'), md5('col:b:grill')::uuid), 'preparing -> cooking into Grill');
select lives_ok(format($$select public.advance_item(%L, 'cooking', %L)$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'b1'), md5('col:b:wok')::uuid), 'same status with a column: moves between columns');
select is((select l ->> 'columnId' from jsonb_array_elements(public.get_board(md5('shop:b')::uuid, md5('station:b:kitchen')::uuid) -> 'lines') l where l ->> 'id' = (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'b1')),
  md5('col:b:wok')::uuid::text, 'the line sits in Wok');
select throws_ok(format($$select public.advance_item(%L, 'ready', %L)$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'b1'), md5('col:b:dcool')::uuid), 'P0001', 'invalid_input', 'a column of another station: invalid_input');
select throws_ok(format($$select public.advance_item(%L, 'ready', %L)$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'b1'), md5('col:b:prep')::uuid), 'P0001', 'invalid_input', 'a column with another core status: invalid_input');
select lives_ok(format($$select public.advance_item(%L, 'ready')$$, (select r -> 'lines' -> 0 ->> 'lineId' from _r where k = 'b1')), 'moving without a column clears it');
select is((select l ->> 'columnId' from jsonb_array_elements(public.get_ready_lines(md5('shop:b')::uuid)) l limit 1), null, 'column_id is null again');

-- To-serve strip across stations, oldest status change first
select lives_ok(format($$select public.advance_item(%L, 'preparing')$$, (select r -> 'lines' -> 1 ->> 'lineId' from _r where k = 'b1')), 'drink: new -> preparing');
select lives_ok(format($$select public.advance_item(%L, 'cooking')$$, (select r -> 'lines' -> 1 ->> 'lineId' from _r where k = 'b1')), 'drink: preparing -> cooking');
select lives_ok(format($$select public.advance_item(%L, 'ready')$$, (select r -> 'lines' -> 1 ->> 'lineId' from _r where k = 'b1')), 'drink: cooking -> ready');
reset role;
update public.order_items set status_changed_at = now() - interval '5 minutes' where id = (select (r -> 'lines' -> 1 ->> 'lineId')::uuid from _r where k = 'b1');
set local role authenticated;
select is((select string_agg(l ->> 'name', ',' order by ord) from jsonb_array_elements(public.get_ready_lines(md5('shop:b')::uuid)) with ordinality t (l, ord)), 'Teh tarik,Nasi lemak',
  'get_ready_lines: all stations, oldest status change first');

select * from finish();
rollback;
