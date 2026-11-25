begin;
select plan(27);

-- Outsider and owner are refused; anonymous has no session
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:outsider')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.admin_list_shops()$$, 'P0001', 'forbidden', 'outsider: forbidden');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.admin_list_shops()$$, 'P0001', 'forbidden', 'owner: list forbidden');
select throws_ok($$select public.admin_create_shop('X Shop', 'x-shop')$$, 'P0001', 'forbidden', 'owner: create forbidden');
select throws_ok($$select public.admin_set_plan(md5('shop:a')::uuid, 'pro')$$, 'P0001', 'forbidden', 'owner: set plan forbidden');
select throws_ok($$select public.admin_set_override(md5('shop:a')::uuid, 'combos', true, null, 'n')$$, 'P0001', 'forbidden', 'owner: override forbidden');
select throws_ok($$select public.admin_set_platform_settings('60123456789')$$, 'P0001', 'forbidden', 'owner: settings forbidden');
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.admin_list_shops()$$, 'P0001', 'not_signed_in', 'no user: not_signed_in');

-- Admin
select set_config('request.jwt.claims', json_build_object('sub', md5('user:admin')::uuid, 'role', 'authenticated')::text, true);
select is(jsonb_array_length(public.admin_list_shops()), 2, 'list shows both seed shops');
select is((select s -> 'ownerEmails' ->> 0 from jsonb_array_elements(public.admin_list_shops()) s where s ->> 'slug' = 'kopitiam-teras'),
  'owner-a@lapar.test', 'owner email listed');

create temp table t_new as select public.admin_create_shop('Warung Ujian', 'warung-ujian') as id;
reset role;
select is((select plan_id from public.shops where id = (select id from t_new)), 'basic', 'new shop is basic');
select is((select count(*) from public.stations where shop_id = (select id from t_new) and name = 'Kitchen'), 1::bigint, 'Kitchen station created');
select is((select c.name from public.shops s join public.categories c on c.id = s.nudge_category_id and c.shop_id = s.id where s.id = (select id from t_new)),
  'Drinks', 'Drinks is the nudge category');
select throws_ok($$select public.admin_create_shop('Dup', 'warung-ujian')$$, 'P0001', 'slug_taken', 'duplicate slug');
select throws_ok($$select public.admin_create_shop('Bad', 'Bad Slug!')$$, 'P0001', 'invalid_input', 'bad slug');

-- Plan and overrides
set local role authenticated;
set local role authenticated;
select public.admin_set_plan(md5('shop:a')::uuid, 'pro');
select is((public.get_entitlements(md5('shop:a')::uuid) -> 'features' ->> 'combos')::boolean, true, 'pro plan enables combos');
select throws_ok($$select public.admin_set_plan(md5('shop:a')::uuid, 'gold')$$, 'P0001', 'invalid_input', 'unknown plan');
select public.admin_set_plan(md5('shop:a')::uuid, 'basic');
select public.admin_set_override(md5('shop:a')::uuid, 'combos', true, null, 'pilot');
select is((public.get_entitlements(md5('shop:a')::uuid) -> 'features' ->> 'combos')::boolean, true, 'override enables combos');
reset role;
reset role;
select is((select changed_by from public.shop_feature_overrides where shop_id = md5('shop:a')::uuid and feature_key = 'combos'),
  md5('user:admin')::uuid, 'changed_by recorded');
set local role authenticated;
set local role authenticated;
select public.admin_set_override(md5('shop:a')::uuid, 'max_tables', null, 40, 'big venue');
select is((public.get_entitlements(md5('shop:a')::uuid) -> 'limits' ->> 'max_tables')::int, 40, 'limit override applies');
select throws_ok($$select public.admin_set_override(md5('shop:a')::uuid, 'combos', null, null, 'n')$$, 'P0001', 'invalid_input', 'feature needs enabled');
select throws_ok($$select public.admin_set_override(md5('shop:a')::uuid, 'combos', true, null, '')$$, 'P0001', 'invalid_input', 'note required');
select is((select s -> 'overrides' -> 0 ->> 'changedByEmail' from jsonb_array_elements(public.admin_list_shops()) s where s ->> 'slug' = 'kopitiam-teras'),
  'admin@lapar.test', 'list shows changer email');
select public.admin_clear_override(md5('shop:a')::uuid, 'combos');
select public.admin_clear_override(md5('shop:a')::uuid, 'max_tables');
select is((public.get_entitlements(md5('shop:a')::uuid) -> 'features' ->> 'combos')::boolean, false, 'cleared: back to plan value');

-- Deactivate (get_menu / place_order shop_inactive are checked once the customer RPCs are merged)
select public.admin_set_shop_active(md5('shop:a')::uuid, false);
reset role;
reset role;
select is((select active from public.shops where id = md5('shop:a')::uuid), false, 'shop deactivated');
set local role authenticated;
set local role authenticated;

-- Platform settings
select public.admin_set_platform_settings('+60 12-345 6789');
select is(public.admin_get_platform_settings() ->> 'whatsappNumber', '60123456789', 'number normalised');
select throws_ok($$select public.admin_set_platform_settings('abc123')$$, 'P0001', 'invalid_input', 'letters rejected');
select public.admin_set_platform_settings('');
select is(public.admin_get_platform_settings() -> 'whatsappNumber', 'null'::jsonb, 'empty clears');

select * from finish();
rollback;
