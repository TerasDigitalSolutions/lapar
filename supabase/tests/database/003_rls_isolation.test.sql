begin;
select plan(140);

-- Fixtures (as postgres): one row in every service table of both shops, a live staff session in A.
insert into public.staff_sessions (auth_uid, shop_id, staff_id, expires_at) values
  (md5('user:device-a')::uuid, md5('shop:a')::uuid, md5('staff:a:aminah')::uuid, now() + interval '1 hour');
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note)
select md5('shop:' || k)::uuid, 'call_server', true, 'test' from (values ('a'), ('b')) v (k);
insert into public.tabs (id, shop_id, table_id, kind)
select md5('tab:' || k)::uuid, md5('shop:' || k)::uuid, md5('table:' || k || ':01')::uuid, 'table' from (values ('a'), ('b')) v (k);
insert into public.orders (id, shop_id, tab_id, status)
select md5('order:' || k)::uuid, md5('shop:' || k)::uuid, md5('tab:' || k)::uuid, 'approved' from (values ('a'), ('b')) v (k);
insert into public.order_items (id, shop_id, order_id, line_no, item_id, name_snapshot, list_price_sen, unit_price_sen, qty, station_id, status)
select md5('line:' || k)::uuid, md5('shop:' || k)::uuid, md5('order:' || k)::uuid, 1, md5('item:' || k || ':kopi')::uuid, 'Kopi', 200, 200, 1,
  md5('station:' || k || ':kitchen')::uuid, 'new' from (values ('a'), ('b')) v (k);
insert into public.tab_payments (shop_id, tab_id, method, amount_sen)
select md5('shop:' || k)::uuid, md5('tab:' || k)::uuid, 'cash', 200 from (values ('a'), ('b')) v (k);
insert into public.service_requests (shop_id, table_id, reason)
select md5('shop:' || k)::uuid, md5('table:' || k || ':02')::uuid, 'water' from (values ('a'), ('b')) v (k);
insert into public.board_columns (shop_id, station_id, name, core_status, sort)
select md5('shop:' || k)::uuid, md5('station:' || k || ':kitchen')::uuid, 'New', 'new', 1 from (values ('a'), ('b')) v (k);
insert into public.auto_pairings (shop_id, source_item_id, suggested_item_id, position, support, confidence)
select md5('shop:' || k)::uuid, md5('item:' || k || ':nasi-lemak')::uuid, md5('item:' || k || ':kopi')::uuid, 1, 5, 0.5
from (values ('a'), ('b')) v (k);

-- Test helper: row count in a table for one shop, run with the caller's own privileges.
create function public.t_cnt(t text, s uuid, col text default 'shop_id') returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where %I = $1', t, col) into n using s;
  return n;
end $$;
grant execute on function public.t_cnt(text, uuid, text) to anon, authenticated;

create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', md5('user:' || p)::uuid, 'role', 'authenticated')::text, true) $$;

create temp table _t (name text);
grant select on _t to authenticated;
insert into _t values ('shop_owners'),('shop_feature_overrides'),('staff'),('stations'),('categories'),('items'),
  ('modifier_groups'),('modifier_options'),('item_pairings'),('auto_pairings'),('combo_components'),('promos'),
  ('promo_items'),('tables'),('tabs'),('orders'),('order_items'),('service_requests'),('tab_payments'),('board_columns');
-- Tables where shop A has seeded or fixture rows.
create temp table _a (name text);
grant select on _a to authenticated;
insert into _a select name from _t where name not in ('combo_components','promos','promo_items');

-- Owner A
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
set local role authenticated;
select is(public.t_cnt('shops', md5('shop:b')::uuid, 'id'), 0::bigint, 'owner A sees no shop B row');
select is(public.t_cnt('shops', md5('shop:a')::uuid, 'id'), 1::bigint, 'owner A sees shop A');
select is(public.t_cnt(name, md5('shop:b')::uuid), 0::bigint, 'owner A sees no B rows in ' || name) from _t;
select cmp_ok(public.t_cnt(name, md5('shop:a')::uuid), '>', 0::bigint, 'owner A sees A rows in ' || name) from _a;
select is((select count(*) from public.shop_owners), 1::bigint, 'owner A sees only own shop_owners row');
select is((select count(*) from public.platform_admins), 0::bigint, 'owner A cannot see platform admins');

-- Owner A cannot write into B
select throws_ok($$insert into public.stations (shop_id, name) values (md5('shop:b')::uuid, 'X')$$, '42501', null, 'owner A cannot insert a B station');
select is_empty($$update public.items set name = 'Hacked' where shop_id = md5('shop:b')::uuid returning 1$$, 'owner A updates no B items');
select is_empty($$update public.shops set name = 'Hacked' where id = md5('shop:b')::uuid returning 1$$, 'owner A updates no B shop');
select is_empty($$delete from public.categories where shop_id = md5('shop:b')::uuid returning 1$$, 'owner A deletes no B categories');
select throws_ok($$insert into public.tables (shop_id, label) values (md5('shop:b')::uuid, 'Table 99')$$, '42501', null, 'owner A cannot insert a B table');
select throws_ok($$insert into public.items (shop_id, category_id, station_id, name, price_sen)
  values (md5('shop:a')::uuid, md5('cat:b:drinks')::uuid, md5('station:a:kitchen')::uuid, 'X', 100)$$, '23503', null,
  'owner A cannot point an A item at a B category (composite FK)');
select throws_ok($$insert into public.tabs (shop_id, table_id, kind) values (md5('shop:a')::uuid, md5('table:a:03')::uuid, 'table')$$,
  '42501', null, 'owner A cannot insert tabs (RPC only)');
select throws_ok($$update public.orders set status = 'rejected' where shop_id = md5('shop:a')::uuid$$, '42501', null, 'owner A cannot update orders (RPC only)');

-- Device with a live session in A
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select is(public.t_cnt(name, md5('shop:b')::uuid), 0::bigint, 'device A sees no B rows in ' || name) from _t;
select cmp_ok(public.t_cnt(name, md5('shop:a')::uuid), '>', 0::bigint, 'device A sees A rows in ' || name)
  from _a where name not in ('shop_feature_overrides');
select is(public.t_cnt('shop_feature_overrides', md5('shop:a')::uuid), 0::bigint, 'staff device cannot read overrides (owner only)');
select is(public.t_cnt('shops', md5('shop:a')::uuid, 'id'), 1::bigint, 'device A sees shop A');
select is(public.t_cnt('shops', md5('shop:b')::uuid, 'id'), 0::bigint, 'device A sees no shop B');
select throws_ok($$insert into public.categories (shop_id, name) values (md5('shop:a')::uuid, 'X')$$, '42501', null, 'staff device cannot insert categories');
select is_empty($$update public.items set name = 'Hacked' where shop_id = md5('shop:a')::uuid returning 1$$, 'staff device updates no items');
select is_empty($$update public.shops set name = 'Hacked' where id = md5('shop:a')::uuid returning 1$$, 'staff device updates no shop');

-- Outsider and the second device
select set_config('request.jwt.claims', json_build_object('sub', md5('user:outsider')::uuid, 'role', 'authenticated')::text, true);
select is(public.t_cnt(name, md5('shop:' || k)::uuid), 0::bigint, 'outsider sees no ' || k || ' rows in ' || name)
  from _t cross join (values ('a'), ('b')) v (k);
select is((select count(*) from public.shops), 0::bigint, 'outsider sees no shops');
select is((select count(*) from public.plans), 2::bigint, 'any signed-in user can read plans');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-b')::uuid, 'role', 'authenticated')::text, true);
select is((select count(*) from public.items), 0::bigint, 'device without a session sees no items');

-- Admin has no policy-level access to shop data
select set_config('request.jwt.claims', json_build_object('sub', md5('user:admin')::uuid, 'role', 'authenticated')::text, true);
select is((select count(*) from public.platform_admins), 1::bigint, 'admin sees own platform_admins row');
select is((select count(*) from public.items), 0::bigint, 'admin sees no items through tables (RPC only)');

-- Anon
reset role;
set local role anon;
select throws_ok($$select * from public.shops$$, '42501', null, 'anon select on shops: permission denied');
select throws_ok($$select * from public.items$$, '42501', null, 'anon select on items: permission denied');
select throws_ok($$select * from public.plans$$, '42501', null, 'anon select on plans: permission denied');
select throws_ok($$insert into public.tabs (shop_id, table_id, kind) values (md5('shop:a')::uuid, md5('table:a:03')::uuid, 'table')$$,
  '42501', null, 'anon insert on tabs: permission denied');

reset role;
select * from finish();
rollback;
