begin;
select plan(30);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);

-- get_menu_editor shape
create temp table _ed as select public.get_menu_editor(md5('shop:a')::uuid) as r;
select is((select array_agg(k order by k) from jsonb_object_keys((select r from _ed)) k),
  array['categories', 'comboComponents', 'groups', 'items', 'nudgeCategoryId', 'options', 'pairings', 'stations'],
  'MenuEditorDTO keys');
select is(jsonb_array_length((select r -> 'categories' from _ed)), 5, 'A: five categories');
select is(jsonb_array_length((select r -> 'items' from _ed)), 20, 'A: twenty items');
select is(jsonb_array_length((select r -> 'pairings' from _ed)), 8, 'A: eight manual pairings');
select is(jsonb_array_length((select r -> 'stations' from _ed)), 1, 'A: one station');
select is(jsonb_array_length((select r -> 'comboComponents' from _ed)), 0, 'A: no components');
select is((select r ->> 'nudgeCategoryId' from _ed), md5('cat:a:drinks')::text::uuid::text, 'nudge category is Drinks');
select is((select r -> 'categories' -> 0 ->> 'name' from _ed), 'Drinks', 'categories sorted by sort');
select is((select array_agg(k order by k) from jsonb_object_keys((select r -> 'categories' -> 0 from _ed)) k),
  array['id', 'name', 'shopId', 'sort', 'translations', 'window'], 'CategoryRow keys');
select is((select r -> 'categories' -> 0 -> 'window' from _ed), 'null'::jsonb, 'A categories have no window');
select is((select array_agg(k order by k) from jsonb_object_keys((select r -> 'items' -> 0 from _ed)) k),
  array['active', 'categoryId', 'description', 'id', 'isCombo', 'name', 'photoState', 'photoUrl', 'priceSen', 'shopId', 'soldOut',
        'sort', 'stationId', 'translations'], 'ItemRow keys');
select is((select count(*) from jsonb_array_elements((select r -> 'groups' from _ed)) g), 16::bigint, 'A: sixteen groups');

reset role;
update public.items set active = false where id = md5('item:a:kopi')::uuid;
set local role authenticated;
select is((select (i ->> 'active')::boolean from jsonb_array_elements(public.get_menu_editor(md5('shop:a')::uuid) -> 'items') i
           where i ->> 'id' = md5('item:a:kopi')::uuid::text), false, 'inactive items are included');

-- Shop B: windows, components, stations
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
select is(jsonb_array_length(public.get_menu_editor(md5('shop:b')::uuid) -> 'comboComponents'), 4, 'B: four components');
select is((select c -> 'window' from jsonb_array_elements(public.get_menu_editor(md5('shop:b')::uuid) -> 'categories') c where c ->> 'name' = 'Breakfast'),
  '{"from": "06:00", "to": "11:30", "days": null}'::jsonb, 'B: Breakfast window object');
select throws_ok($$select public.get_menu_editor(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'owner B cannot read A editor');
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.get_menu_editor(md5('shop:a')::uuid)$$, 'P0001', 'not_signed_in', 'not signed in');

-- set_item_pairings (manual_pairings is a Basic feature)
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select lives_ok($$select public.set_item_pairings(md5('item:a:nasi-lemak')::uuid,
  array[md5('item:a:sirap-bandung')::uuid, md5('item:a:kopi-o')::uuid, md5('item:a:telur-mata')::uuid])$$, 'set three pairings');
select is((select array_agg(suggested_item_id order by position) from public.item_pairings where source_item_id = md5('item:a:nasi-lemak')::uuid),
  array[md5('item:a:sirap-bandung')::uuid, md5('item:a:kopi-o')::uuid, md5('item:a:telur-mata')::uuid], 'positions follow the array order');
select lives_ok($$select public.set_item_pairings(md5('item:a:nasi-lemak')::uuid, array[md5('item:a:kopi-o')::uuid])$$, 'replace with one');
select is((select count(*) from public.item_pairings where source_item_id = md5('item:a:nasi-lemak')::uuid), 1::bigint, 'old rows replaced');
select lives_ok($$select public.set_item_pairings(md5('item:a:nasi-lemak')::uuid, '{}')$$, 'an empty list clears');
select is((select count(*) from public.item_pairings where source_item_id = md5('item:a:nasi-lemak')::uuid), 0::bigint, 'cleared');
select throws_ok($$select public.set_item_pairings(md5('item:a:nasi-lemak')::uuid,
  array[md5('item:a:kopi')::uuid, md5('item:a:kopi-o')::uuid, md5('item:a:milo-ais')::uuid, md5('item:a:teh-tarik')::uuid])$$,
  'P0001', 'invalid_input', 'four suggestions: invalid_input');
select throws_ok($$select public.set_item_pairings(md5('item:a:nasi-lemak')::uuid, array[md5('item:b:kopi')::uuid])$$,
  'P0001', 'invalid_input', 'another shop''s item: invalid_input');
select throws_ok($$select public.set_item_pairings(md5('item:a:nasi-lemak')::uuid, array[md5('item:a:nasi-lemak')::uuid])$$,
  'P0001', 'invalid_input', 'the item itself: invalid_input');
select throws_ok($$select public.set_item_pairings(md5('item:a:nasi-lemak')::uuid, array[md5('item:a:kopi')::uuid, md5('item:a:kopi')::uuid])$$,
  'P0001', 'invalid_input', 'duplicates: invalid_input');
select throws_ok($$select public.set_item_pairings(md5('item:a:nobody')::uuid, '{}')$$, 'P0001', 'not_found', 'unknown item: not_found');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.set_item_pairings(md5('item:a:nasi-lemak')::uuid, '{}')$$, 'P0001', 'forbidden', 'owner B cannot edit A pairings');
reset role;
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:a')::uuid, 'manual_pairings', false, 'test');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.set_item_pairings(md5('item:a:nasi-lemak')::uuid, '{}')$$, 'P0001', 'feature_not_enabled', 'override off: feature_not_enabled');

select * from finish();
rollback;
