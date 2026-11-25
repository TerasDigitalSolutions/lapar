begin;
select plan(79);

-- Runs one statement as the current claims and returns 'ok' or the error code (sqlerrm).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then return sqlerrm;
end $$;

create temp table _calls (name text, tpl text);
insert into _calls values
  ('set_board_columns', $t$select public.set_board_columns(md5('station:{k}:kitchen')::uuid,
     '[{"name":"New","coreStatus":"new"},{"name":"Prep","coreStatus":"preparing"},{"name":"Grill","coreStatus":"cooking"},{"name":"Pass","coreStatus":"ready"}]')$t$),
  ('save_promo', $t$select public.save_promo(jsonb_build_object('shopId', md5('shop:{k}')::uuid, 'name', 'Test', 'discountType', 'percent',
     'discountValue', 10, 'days', jsonb_build_array(1, 2), 'startTime', '10:00', 'endTime', '11:00', 'itemIds', jsonb_build_array(md5('item:{k}:kopi')::uuid)))$t$),
  ('set_combo_components', $t$select public.set_combo_components(md5('item:{k}:{combo}')::uuid,
     jsonb_build_array(jsonb_build_object('itemId', md5('item:{k}:nasi-lemak')::uuid, 'qty', 1)))$t$),
  ('regenerate_pickup_board_token', $t$select public.regenerate_pickup_board_token(md5('shop:{k}')::uuid)$t$),
  ('get_sales_report', $t$select public.get_sales_report(md5('shop:{k}')::uuid, public.myt_today() - 5, public.myt_today())$t$),
  ('get_upsell_report', $t$select public.get_upsell_report(md5('shop:{k}')::uuid, public.myt_today())$t$),
  ('export_shop_meta', $t$select public.export_shop_meta(md5('shop:{k}')::uuid)$t$),
  ('export_orders', $t$select public.export_orders(md5('shop:{k}')::uuid, public.myt_today() - 5, public.myt_today())$t$);

-- Every Pro owner RPC on Basic shop A: feature_not_enabled; on Pro shop B: works
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select is(pg_temp.err(replace(replace(tpl, '{k}', 'a'), '{combo}', 'kopi')), 'feature_not_enabled', 'A: ' || name || ' is gated') from _calls order by name;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
select is(pg_temp.err(replace(replace(tpl, '{k}', 'b'), '{combo}', 'set-a')), 'ok', 'B: ' || name || ' works') from _calls order by name;

-- Gates follow entitlements: an override off removes it, an override on grants it
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:b')::uuid, 'full_reports', false, 'test');
select is(pg_temp.err($$select public.get_sales_report(md5('shop:b')::uuid, public.myt_today() - 5, public.myt_today())$$), 'feature_not_enabled', 'B: override off gates get_sales_report');
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:a')::uuid, 'custom_columns', true, 'test');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select is(pg_temp.err($$select public.set_board_columns(md5('station:a:kitchen')::uuid,
  '[{"name":"New","coreStatus":"new"},{"name":"Prep","coreStatus":"preparing"},{"name":"Grill","coreStatus":"cooking"},{"name":"Pass","coreStatus":"ready"}]')$$),
  'ok', 'A: override on grants set_board_columns');
select is(pg_temp.err($$select public.set_board_columns(md5('station:b:kitchen')::uuid, '[]')$$), 'forbidden', 'owner A cannot edit B columns');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);

-- set_board_columns on B
delete from public.board_columns where shop_id = md5('shop:b')::uuid;
create temp table _c1 as select public.set_board_columns(md5('station:b:kitchen')::uuid, '[
  {"name":"Queue","coreStatus":"new"},{"name":"Prep","coreStatus":"preparing"},{"name":"Grill","coreStatus":"cooking"},
  {"name":"Pass","coreStatus":"ready"},{"name":"Plated","coreStatus":"ready"}]') as r;
select is(jsonb_array_length((select r from _c1)), 5, 'five columns saved');
select is((select array_agg((c ->> 'sort')::int order by (c ->> 'sort')::int) from _c1, jsonb_array_elements(r) c), array[0, 1, 2, 3, 4], 'sort = list index');
select is((select r -> 2 ->> 'coreStatus' from _c1), 'cooking', 'BoardColumnRow coreStatus');
create temp table _c as select (c ->> 'id')::uuid id, c ->> 'name' name from _c1, jsonb_array_elements(r) c;
create temp table _dc as select public.set_board_columns(md5('station:b:drinks')::uuid,
  '[{"name":"A","coreStatus":"new"},{"name":"B","coreStatus":"preparing"},{"name":"C","coreStatus":"cooking"},{"name":"D","coreStatus":"ready"}]') as r;
create function pg_temp.cols(p_extra text) returns text language sql as $$
  select '[{"name":"New","coreStatus":"new"},{"name":"Prep","coreStatus":"preparing"},{"name":"Grill","coreStatus":"cooking"},{"name":"Pass","coreStatus":"ready"}' || p_extra || ']'
$$;
select is(pg_temp.err($$select public.set_board_columns(md5('station:b:kitchen')::uuid, '[{"name":"New","coreStatus":"new"}]')$$), 'invalid_input', 'fewer than 4 columns');
select is(pg_temp.err($$select public.set_board_columns(md5('station:b:kitchen')::uuid, '[{"name":"New","coreStatus":"new"},{"name":"b","coreStatus":"new"},{"name":"c","coreStatus":"new"},{"name":"d","coreStatus":"new"},{"name":"e","coreStatus":"new"},{"name":"f","coreStatus":"new"},{"name":"g","coreStatus":"new"},{"name":"h","coreStatus":"new"},{"name":"i","coreStatus":"new"},{"name":"j","coreStatus":"new"},{"name":"k","coreStatus":"new"},{"name":"l","coreStatus":"new"},{"name":"m","coreStatus":"new"}]')$$), 'invalid_input', 'more than 12 columns');
select is(pg_temp.err($$select public.set_board_columns(md5('station:b:kitchen')::uuid, '[{"name":"a","coreStatus":"new"},{"name":"b","coreStatus":"preparing"},{"name":"c","coreStatus":"ready"},{"name":"d","coreStatus":"ready"}]')$$), 'invalid_input', 'cooking is missing');
select is(pg_temp.err($$select public.set_board_columns(md5('station:b:kitchen')::uuid, '[{"name":"a","coreStatus":"new"},{"name":"b","coreStatus":"preparing"},{"name":"c","coreStatus":"ready"},{"name":"d","coreStatus":"cooking"}]')$$), 'invalid_input', 'statuses never go backwards');
select is(pg_temp.err(format($f$select public.set_board_columns(md5('station:b:kitchen')::uuid, %L)$f$, pg_temp.cols(', {"name":"' || repeat('x', 25) || '","coreStatus":"ready"}'))), 'invalid_input', 'name over 24 characters');
select is(pg_temp.err(format($f$select public.set_board_columns(md5('station:b:kitchen')::uuid, %L)$f$, pg_temp.cols(', {"name":" ","coreStatus":"ready"}'))), 'invalid_input', 'blank name');
select is(pg_temp.err(format($f$select public.set_board_columns(md5('station:b:kitchen')::uuid, %L)$f$, pg_temp.cols(', {"name":"x","coreStatus":"served"}'))), 'invalid_input', 'served is not a board status');
select is(pg_temp.err(format($f$select public.set_board_columns(md5('station:b:kitchen')::uuid, %L)$f$, pg_temp.cols(', {"id":"' || (_dc.r -> 0 ->> 'id') || '","name":"x","coreStatus":"ready"}'))), 'invalid_input', 'a column of another station')
  from _dc;
select is(pg_temp.err(format($f$select public.set_board_columns(md5('station:b:kitchen')::uuid, %L)$f$, pg_temp.cols(', {"id":"' || (select id from _c where name = 'Plated') || '","name":"x","coreStatus":"ready"}, {"id":"' || (select id from _c where name = 'Plated') || '","name":"y","coreStatus":"ready"}'))), 'invalid_input', 'the same id twice');
select is(pg_temp.err($$select public.set_board_columns(md5('station:b:kitchen')::uuid, '{"a":1}')$$), 'invalid_input', 'not an array');
select is(pg_temp.err($$select public.set_board_columns(md5('station:b:nope')::uuid, '[]')$$), 'not_found', 'unknown station: not_found');

-- Lines fall back to the first column of their status when their column goes away or changes status
update public.order_items set status = 'cooking', column_id = (select id from _c where name = 'Grill')
  where id = (select id from public.order_items where shop_id = md5('shop:b')::uuid order by id limit 1);
update public.order_items set status = 'preparing', column_id = (select id from _c where name = 'Prep')
  where id = (select id from public.order_items where shop_id = md5('shop:b')::uuid order by id desc limit 1);
select public.set_board_columns(md5('station:b:kitchen')::uuid, format('[{"id":"%s","name":"Queue","coreStatus":"new"},{"id":"%s","name":"Prep 2","coreStatus":"preparing"},
  {"id":"%s","name":"Grill","coreStatus":"cooking"},{"id":"%s","name":"Pass","coreStatus":"ready"}]',
  (select id from _c where name = 'Queue'), (select id from _c where name = 'Prep'), (select id from _c where name = 'Grill'), (select id from _c where name = 'Pass'))::jsonb);
select is((select count(*) from public.board_columns where station_id = md5('station:b:kitchen')::uuid), 4::bigint, 'the dropped column is deleted');
select is((select name from public.board_columns where id = (select id from _c where name = 'Prep')), 'Prep 2', 'a kept id is renamed in place');
select is((select count(*) from public.order_items where column_id = (select id from _c where name = 'Grill')), 1::bigint, 'a line stays in its kept column');
select public.set_board_columns(md5('station:b:kitchen')::uuid, format('[{"id":"%s","name":"Queue","coreStatus":"new"},{"name":"Prep 3","coreStatus":"preparing"},
  {"id":"%s","name":"Prep","coreStatus":"cooking"},{"id":"%s","name":"Pass","coreStatus":"ready"}]',
  (select id from _c where name = 'Queue'), (select id from _c where name = 'Prep'), (select id from _c where name = 'Pass'))::jsonb);
select is((select count(*) from public.order_items where column_id = (select id from _c where name = 'Grill')), 0::bigint, 'a line in a removed column falls back');
select is((select count(*) from public.order_items where column_id = (select id from _c where name = 'Prep')), 0::bigint, 'a line in a re-typed column falls back');

-- save_promo on B
create temp table _p1 as select public.save_promo(jsonb_build_object('shopId', md5('shop:b')::uuid, 'name', ' Lunch ', 'discountType', 'amount',
  'discountValue', 50, 'days', jsonb_build_array(5, 1, 1), 'startTime', '11:00', 'endTime', '14:00',
  'itemIds', jsonb_build_array(md5('item:b:nasi-lemak')::uuid, md5('item:b:mee-rebus')::uuid), 'translations', '{"ms":{"name":"Tengah hari"}}'::jsonb)) as r;
select is((select r ->> 'name' from _p1), 'Lunch', 'promo created, name trimmed');
select is((select r -> 'days' from _p1), '[1, 5]'::jsonb, 'days are de-duplicated and sorted');
select is((select r ->> 'startTime' from _p1) || '-' || (select r ->> 'endTime' from _p1), '11:00-14:00', 'times as HH:MM');
select is((select jsonb_array_length(r -> 'itemIds') from _p1), 2, 'two items');
select is((select r -> 'translations' -> 'ms' ->> 'name' from _p1), 'Tengah hari', 'translations kept');
select is((select count(*) from public.promo_items where promo_id = (select (r ->> 'id')::uuid from _p1)), 2::bigint, 'promo_items written');
select is(public.save_promo(jsonb_build_object('id', (select r ->> 'id' from _p1), 'shopId', md5('shop:b')::uuid, 'name', 'Lunch 2', 'discountType', 'percent',
  'discountValue', 15, 'days', jsonb_build_array(1), 'startTime', '22:00', 'endTime', '02:00', 'itemIds', jsonb_build_array(md5('item:b:kopi')::uuid), 'active', false)) ->> 'name',
  'Lunch 2', 'update by id (a window may cross midnight)');
select is((select count(*) from public.promos where shop_id = md5('shop:b')::uuid), 3::bigint, 'the update did not add a promo');
select is((select array_agg(item_id) from public.promo_items where promo_id = (select (r ->> 'id')::uuid from _p1)), array[md5('item:b:kopi')::uuid], 'promo_items replaced');
select is((select active from public.promos where id = (select (r ->> 'id')::uuid from _p1)), false, 'active flag saved');
create temp table _base as select jsonb_build_object('shopId', md5('shop:b')::uuid, 'name', 'X', 'discountType', 'percent', 'discountValue', 10,
  'days', jsonb_build_array(1), 'startTime', '10:00', 'endTime', '11:00', 'itemIds', jsonb_build_array(md5('item:b:kopi')::uuid)) as b;
select is(pg_temp.err(format($f$select public.save_promo(%L::jsonb || %L::jsonb)$f$, (select b from _base), v.patch)), 'invalid_input', 'invalid promo: ' || v.patch)
  from (values ('{"discountValue":101}'), ('{"discountValue":0}'), ('{"discountValue":1.5}'), ('{"discountValue":"ten"}'), ('{"discountType":"free"}'),
    ('{"days":[]}'), ('{"days":[8]}'), ('{"days":"all"}'), ('{"endTime":"10:00"}'), ('{"startTime":"25:00"}'), ('{"startTime":"9:00"}'),
    ('{"name":"  "}'), ('{"itemIds":"x"}'), ('{"itemIds":["' || md5('item:a:kopi') || '"]}')) v (patch);
select is(pg_temp.err(format($f$select public.save_promo(%L::jsonb || %L::jsonb)$f$, (select b from _base), '{"id":"' || md5('promo:nope') || '"}')), 'not_found', 'unknown promo id: not_found');
select is(pg_temp.err(format($f$select public.save_promo(%L::jsonb)$f$, (select b from _base) || ('{"shopId":"' || md5('shop:a') || '"}')::jsonb)), 'forbidden', 'owner B cannot save a promo into A');

-- set_combo_components on B
select lives_ok($$select public.set_combo_components(md5('item:b:set-a')::uuid, jsonb_build_array(
  jsonb_build_object('itemId', md5('item:b:nasi-lemak')::uuid, 'qty', 2), jsonb_build_object('itemId', md5('item:b:kopi')::uuid, 'qty', 1)))$$, 'set components');
select is((select array_agg(item_id::text || ':' || qty order by sort) from public.combo_components where combo_item_id = md5('item:b:set-a')::uuid),
  array[md5('item:b:nasi-lemak')::uuid::text || ':2', md5('item:b:kopi')::uuid::text || ':1'], 'rows replaced, sort = list order');
select is(pg_temp.err($$select public.set_combo_components(md5('item:b:teh-tarik')::uuid, jsonb_build_array(jsonb_build_object('itemId', md5('item:b:kopi')::uuid, 'qty', 1)))$$), 'invalid_input', 'not a set item');
select is(pg_temp.err($$select public.set_combo_components(md5('item:b:set-a')::uuid, '[]')$$), 'invalid_input', 'at least one component');
select is(pg_temp.err($$select public.set_combo_components(md5('item:b:set-a')::uuid, (select jsonb_agg(jsonb_build_object('itemId', i.id, 'qty', 1))
  from (select id from public.items where shop_id = md5('shop:b')::uuid and not is_combo order by id limit 7) i))$$), 'invalid_input', 'at most six components');
select is(pg_temp.err($$select public.set_combo_components(md5('item:b:set-a')::uuid, jsonb_build_array(jsonb_build_object('itemId', md5('item:b:set-b')::uuid, 'qty', 1)))$$), 'invalid_input', 'no nested sets');
select is(pg_temp.err($$select public.set_combo_components(md5('item:b:set-a')::uuid, jsonb_build_array(
  jsonb_build_object('itemId', md5('item:b:kopi')::uuid, 'qty', 1), jsonb_build_object('itemId', md5('item:b:kopi')::uuid, 'qty', 1)))$$), 'invalid_input', 'distinct components');
select is(pg_temp.err($$select public.set_combo_components(md5('item:b:set-a')::uuid, jsonb_build_array(jsonb_build_object('itemId', md5('item:b:kopi')::uuid, 'qty', 11)))$$), 'invalid_input', 'qty 11');
select is(pg_temp.err($$select public.set_combo_components(md5('item:b:set-a')::uuid, jsonb_build_array(jsonb_build_object('itemId', md5('item:b:kopi')::uuid, 'qty', 0)))$$), 'invalid_input', 'qty 0');
select is(pg_temp.err($$select public.set_combo_components(md5('item:b:set-a')::uuid, jsonb_build_array(jsonb_build_object('itemId', md5('item:a:kopi')::uuid, 'qty', 1)))$$), 'invalid_input', 'another shop''s item');
select is(pg_temp.err($$select public.set_combo_components(md5('item:b:nobody')::uuid, '[]')$$), 'not_found', 'unknown item: not_found');

-- regenerate_pickup_board_token
create temp table _tk as select public.regenerate_pickup_board_token(md5('shop:b')::uuid) as t;
select cmp_ok(char_length((select t from _tk)), '>=', 22, 'a new token of at least 22 characters');
select throws_ok($$select public.get_pickup_board('lapar-local-b-pickup-01')$$, 'P0001', 'not_found', 'the old pickup board link stops working');
select lives_ok($$select public.get_pickup_board((select t from _tk))$$, 'the new link works');
select is((select pickup_board_token from public.shops where id = md5('shop:b')::uuid), (select t from _tk), 'stored on the shop');

select * from finish();
rollback;
