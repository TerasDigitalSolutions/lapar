begin;
select plan(27);

-- Tables on Basic shop A (seed has 10; limit 15)
insert into public.tables (shop_id, label) select md5('shop:a')::uuid, 'Table ' || n from generate_series(11, 15) n;
select throws_ok($$insert into public.tables (shop_id, label) values (md5('shop:a')::uuid, 'Table 16')$$, 'P0001', 'limit_reached', '16th table on A: limit_reached');
select throws_ok($$insert into public.tables (shop_id, label) values (md5('shop:a')::uuid, 'Table 16')$$, 'P0001', 'limit_reached', 'limit_reached again (nothing was inserted)');
select is((select count(*) from public.tables where shop_id = md5('shop:a')::uuid and active), 15::bigint, 'A still has 15 active tables');

-- Inactive rows do not count; reactivating over the limit is refused
update public.tables set active = false where id = md5('table:a:01')::uuid;
select lives_ok($$insert into public.tables (shop_id, label) values (md5('shop:a')::uuid, 'Table 16')$$, 'a freed slot can be used');
select throws_ok($$update public.tables set active = true where id = md5('table:a:01')::uuid$$, 'P0001', 'limit_reached', 'reactivating over the limit: limit_reached');
select lives_ok($$update public.tables set sort = 99 where id = md5('table:a:02')::uuid$$, 'updating other columns of an active table is fine');

-- Counters: need takeaway, and never count toward max_tables
select throws_ok($$insert into public.tables (shop_id, label, kind) values (md5('shop:a')::uuid, 'Counter', 'counter')$$,
  'P0001', 'feature_not_enabled', 'counter on Basic A: feature_not_enabled');
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:a')::uuid, 'takeaway', true, 'test');
select lives_ok($$insert into public.tables (shop_id, label, kind) values (md5('shop:a')::uuid, 'Counter', 'counter')$$,
  'counter allowed once takeaway is on, even with 15 tables active');
select is((select count(*) from public.tables where shop_id = md5('shop:a')::uuid and active and kind = 'table'), 15::bigint, 'counter did not change the table count');

-- Stations
select throws_ok($$insert into public.stations (shop_id, name) values (md5('shop:a')::uuid, 'Drinks')$$, 'P0001', 'limit_reached', '2nd station on A: limit_reached');
select lives_ok($$insert into public.stations (shop_id, name) values (md5('shop:b')::uuid, 'Grill')$$, 'Pro B can add a 3rd station');

-- Staff (A has Aminah and Ravi; limit 3)
select lives_ok($$insert into public.staff (shop_id, name) values (md5('shop:a')::uuid, 'Third')$$, '3rd staff on A ok');
select throws_ok($$insert into public.staff (shop_id, name) values (md5('shop:a')::uuid, 'Fourth')$$, 'P0001', 'limit_reached', '4th staff on A: limit_reached');
update public.staff set active = false where id = md5('staff:a:ravi')::uuid;
select lives_ok($$insert into public.staff (shop_id, name) values (md5('shop:a')::uuid, 'Fourth')$$, 'a deactivated member frees a slot');
select throws_ok($$update public.staff set active = true where id = md5('staff:a:ravi')::uuid$$, 'P0001', 'limit_reached', 'reactivating that member over the limit: limit_reached');
select lives_ok($$insert into public.staff (shop_id, name, active) values (md5('shop:a')::uuid, 'Away', false)$$, 'an inactive staff row never counts');

-- Combos
select throws_ok($$insert into public.items (shop_id, category_id, name, price_sen, is_combo)
  values (md5('shop:a')::uuid, md5('cat:a:drinks')::uuid, 'Combo', 500, true)$$, 'P0001', 'feature_not_enabled', 'combo item on A: feature_not_enabled');
select throws_ok($$update public.items set is_combo = true where id = md5('item:a:kopi')::uuid$$, 'P0001', 'feature_not_enabled', 'flagging an A item as combo: feature_not_enabled');
select lives_ok($$insert into public.items (shop_id, category_id, name, price_sen, is_combo)
  values (md5('shop:b')::uuid, md5('cat:b:sets')::uuid, 'Set C', 500, true)$$, 'combo item on Pro B ok');

-- items_set_defaults, touch_updated_at
insert into public.items (id, shop_id, category_id, name, price_sen) values (md5('item:a:new')::uuid, md5('shop:a')::uuid, md5('cat:a:drinks')::uuid, 'New drink', 100);
select is((select station_id from public.items where id = md5('item:a:new')::uuid), md5('station:a:kitchen')::uuid, 'item without station gets the default station');
update public.items set name = 'Newer drink', updated_at = '2000-01-01' where id = md5('item:a:new')::uuid;
select is((select updated_at from public.items where id = md5('item:a:new')::uuid), now(), 'touch_updated_at overrides updated_at');

-- keep_one_station
select throws_ok($$update public.stations set active = false where id = md5('station:a:kitchen')::uuid$$, 'P0001', 'invalid_input', 'last station on A cannot be deactivated');
select lives_ok($$update public.stations set active = false where id = md5('station:b:drinks')::uuid$$, 'B can deactivate one of two stations');
update public.stations set active = false where name = 'Grill';
select throws_ok($$update public.stations set active = false where id = md5('station:b:kitchen')::uuid$$, 'P0001', 'invalid_input', 'B cannot deactivate its last active station');
update public.stations set active = true where name = 'Grill';

-- Downgrade: existing over-limit rows keep working, new ones are refused
update public.shops set plan_id = 'basic' where id = md5('shop:b')::uuid;
select lives_ok($$update public.stations set name = 'Panggang' where name = 'Grill'$$, 'after downgrade the extra station keeps working');
select throws_ok($$insert into public.stations (shop_id, name) values (md5('shop:b')::uuid, 'More')$$, 'P0001', 'limit_reached', 'after downgrade a new station is refused');
update public.stations set active = false where id = md5('station:b:kitchen')::uuid;
select throws_ok($$update public.stations set active = true where id = md5('station:b:kitchen')::uuid$$, 'P0001', 'limit_reached', 'after downgrade reactivating a station is refused');

select * from finish();
rollback;
