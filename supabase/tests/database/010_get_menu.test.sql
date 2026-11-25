begin;
select plan(27);

-- Fixtures changed as postgres: shop B promo and category windows (tests cannot move the clock, so windows move around now()).
-- covers_now / misses_now are MYT times relative to now().
create temp table _t as select (now() at time zone 'Asia/Kuala_Lumpur')::time as t;
grant select on _t to anon;

set local role anon;

select throws_ok($$select public.get_menu('no-such-token-xxxxxxxxxxxxxxxx')$$, 'P0001', 'not_found', 'unknown token: not_found');
select throws_ok($$select public.get_menu(null)$$, 'P0001', 'not_found', 'null token: not_found');

-- Shop A (Basic)
select is(public.get_menu('lapar-local-a-table-01') #>> '{shop,name}', 'Kopitiam Teras', 'A: shop name');
select is(public.get_menu('lapar-local-a-table-01') #>> '{table,label}', 'Table 1', 'A: table label');
select is((public.get_menu('lapar-local-a-table-01') #>> '{features,combos}')::boolean, false, 'A: combos off in feature map');
select is(jsonb_array_length(public.get_menu('lapar-local-a-table-01') -> 'items'), 20, 'A: 20 items, no combos');
select is((select count(*) from jsonb_path_query(public.get_menu('lapar-local-a-table-01'), '$.items[*] ? (@.combo != null)')), 0::bigint, 'A: no combo objects');
select is((select count(*) from jsonb_path_query(public.get_menu('lapar-local-a-table-01'), '$.items[*] ? (exists(@.translations.*))')), 0::bigint,
  'A: no item translations');
select is((select count(*) from jsonb_path_query(public.get_menu('lapar-local-a-table-01'), '$.categories[*] ? (@.window != null || @.availableNow == false)')), 0::bigint,
  'A: no windows, always available');
select is((select count(*) from jsonb_path_query(public.get_menu('lapar-local-a-table-01'), '$.items[*] ? (@.promo != null)')), 0::bigint, 'A: no promo');

-- Basic ignores data that belongs to Pro even when it exists (written as postgres)
reset role;
update public.categories set available_from = '00:00', available_to = '00:01' where id = md5('cat:a:rice')::uuid;
update public.items set translations = '{"ms":{"name":"x"}}' where id = md5('item:a:kopi')::uuid;
insert into public.promos (id, shop_id, name, discount_type, discount_value, start_time, end_time)
  values (md5('promo:a:x')::uuid, md5('shop:a')::uuid, 'X', 'percent', 50, '00:00', '23:59');
insert into public.promo_items (shop_id, promo_id, item_id) values (md5('shop:a')::uuid, md5('promo:a:x')::uuid, md5('item:a:teh-tarik')::uuid);
set local role anon;
select is(jsonb_path_query_first(public.get_menu('lapar-local-a-table-01'), '$.categories[*] ? (@.name == "Rice")') -> 'window', 'null'::jsonb, 'A: stored window not shown');
select is(jsonb_path_query_first(public.get_menu('lapar-local-a-table-01'), '$.categories[*] ? (@.name == "Rice")') ->> 'availableNow', 'true', 'A: stored window not applied');
select is(jsonb_path_query_first(public.get_menu('lapar-local-a-table-01'), '$.items[*] ? (@.name == "Kopi")') -> 'translations', '{}'::jsonb, 'A: stored translations hidden');
select is(jsonb_path_query_first(public.get_menu('lapar-local-a-table-01'), '$.items[*] ? (@.name == "Teh tarik")') ->> 'effectivePriceSen', '220', 'A: stored promo not applied');

-- Suggestions in position order (manual), options in sort order, sold-out flag
select is((select jsonb_agg(s ->> 'itemId' order by ord) from jsonb_array_elements(
    jsonb_path_query_first(public.get_menu('lapar-local-a-table-01'), '$.items[*] ? (@.name == "Nasi lemak")') -> 'suggestions') with ordinality x (s, ord)),
  jsonb_build_array(md5('item:a:teh-tarik')::uuid, md5('item:a:telur-mata')::uuid, md5('item:a:ayam-goreng')::uuid),
  'A: suggestions follow pairing positions');
select is(jsonb_path_query_first(public.get_menu('lapar-local-a-table-01'), '$.items[*] ? (@.name == "Teh tarik")') #>> '{groups,0,options,1,priceDeltaSen}', '30', 'A: option delta shown');
reset role;
update public.items set sold_out = true where id = md5('item:a:kopi')::uuid;
set local role anon;
select is(jsonb_path_query_first(public.get_menu('lapar-local-a-table-01'), '$.items[*] ? (@.name == "Kopi")') ->> 'soldOut', 'true', 'A: sold-out flag');

-- Shop B (Pro)
select is((select count(*) from jsonb_path_query(public.get_menu('lapar-local-b-table-01'), '$.items[*] ? (@.combo != null)')), 2::bigint, 'B: two sets with components');
select is(jsonb_array_length(jsonb_path_query_first(public.get_menu('lapar-local-b-table-01'), '$.items[*] ? (@.name == "Set A")') #> '{combo,components}'), 2, 'B: Set A has 2 components');
select is(jsonb_path_query_first(public.get_menu('lapar-local-b-table-01'), '$.items[*] ? (@.name == "Kaya toast")') #>> '{translations,ms,name}', 'Roti bakar kaya', 'B: translations present');

-- Windows and promo on B, set around now
reset role;
update public.categories set available_from = ((select t from _t) + interval '2 hours')::time, available_to = ((select t from _t) + interval '3 hours')::time
  where id = md5('cat:b:breakfast')::uuid;
update public.categories set available_from = '00:00', available_to = '23:59' where id = md5('cat:b:noodles')::uuid;
update public.promos set start_time = '00:00', end_time = '23:59' where id = md5('promo:b:happy-hour')::uuid;
set local role anon;
select is((select array_agg(c ->> 'name' || '=' || (c ->> 'availableNow') order by c ->> 'name')
           from jsonb_path_query(public.get_menu('lapar-local-b-table-01'), '$.categories[*] ? (@.name == "Breakfast" || @.name == "Noodles")') c),
  array['Breakfast=false', 'Noodles=true'], 'B: category outside its window is not available now');
select is(jsonb_path_query_first(public.get_menu('lapar-local-b-table-01'), '$.items[*] ? (@.name == "Teh tarik")') ->> 'effectivePriceSen', '176', 'B: promo window covers now: 176 sen');
select is(jsonb_path_query_first(public.get_menu('lapar-local-b-table-01'), '$.items[*] ? (@.name == "Teh tarik")') #>> '{promo,name}', 'Happy hour', 'B: promo named');

-- Auto pairings come after manual ones; inactive suggestions are dropped
reset role;
insert into public.auto_pairings (shop_id, source_item_id, suggested_item_id, position, support, confidence) values
  (md5('shop:b')::uuid, md5('item:b:nasi-lemak')::uuid, md5('item:b:kopi')::uuid, 1, 5, 0.5),
  (md5('shop:b')::uuid, md5('item:b:nasi-lemak')::uuid, md5('item:b:teh-tarik')::uuid, 2, 5, 0.4);
update public.items set active = false where id = md5('item:b:ayam-goreng')::uuid;
set local role anon;
select is((select jsonb_agg(s ->> 'source' || ':' || (s ->> 'itemId') order by ord) from jsonb_array_elements(
    jsonb_path_query_first(public.get_menu('lapar-local-b-table-01'), '$.items[*] ? (@.name == "Nasi lemak")') -> 'suggestions') with ordinality x (s, ord)),
  jsonb_build_array('manual:' || md5('item:b:teh-tarik')::uuid, 'manual:' || md5('item:b:telur-mata')::uuid, 'auto:' || md5('item:b:kopi')::uuid),
  'B: manual by position, then auto, no duplicates, inactive dropped');

-- Nudge category follows checkout_nudge; counter token; inactive shop
reset role;
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:a')::uuid, 'checkout_nudge', false, 'test');
set local role anon;
select is(public.get_menu('lapar-local-a-table-01') #> '{shop,nudgeCategoryId}', 'null'::jsonb, 'A: nudge category hidden when checkout_nudge is off');
select is(public.get_menu('lapar-local-b-counter-1') #>> '{table,kind}', 'counter', 'B: counter token');
reset role;
update public.shops set active = false where id = md5('shop:b')::uuid;
set local role anon;
select is(public.get_menu('lapar-local-b-table-01') -> 'items', '[]'::jsonb, 'inactive shop: active=false and empty items');

select * from finish();
rollback;
