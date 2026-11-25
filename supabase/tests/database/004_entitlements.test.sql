begin;
select plan(21);

insert into public.staff_sessions (auth_uid, shop_id, staff_id, expires_at) values
  (md5('user:device-a')::uuid, md5('shop:a')::uuid, md5('staff:a:aminah')::uuid, now() + interval '1 hour');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);

-- Shop A: Basic
select is((public.get_entitlements(md5('shop:a')::uuid) -> 'features' ->> 'qr_ordering')::boolean, true, 'A has qr_ordering');
select is((public.get_entitlements(md5('shop:a')::uuid) -> 'features' ->> 'combos')::boolean, false, 'A has no combos');
select is((select count(*) from jsonb_object_keys(public.get_entitlements(md5('shop:a')::uuid) -> 'features')), 25::bigint, '25 feature keys returned');
select is((select count(*) from jsonb_object_keys(public.get_entitlements(md5('shop:a')::uuid) -> 'limits')), 4::bigint, '4 limit keys returned');
select is((public.get_entitlements(md5('shop:a')::uuid) -> 'limits' ->> 'max_tables')::int, 15, 'A max_tables 15');
select is((public.get_entitlements(md5('shop:a')::uuid) -> 'limits' ->> 'report_history_days')::int, 30, 'A report_history_days 30');

-- Owner A cannot read B; outsider and anonymous-style callers are refused
select throws_ok($$select public.get_entitlements(md5('shop:b')::uuid)$$, 'P0001', 'forbidden', 'owner A cannot read B entitlements');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:outsider')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.get_entitlements(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'outsider: forbidden');
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.get_entitlements(md5('shop:a')::uuid)$$, 'P0001', 'not_signed_in', 'no user: not_signed_in');

-- Staff device and admin
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select is((public.get_entitlements(md5('shop:a')::uuid) -> 'features' ->> 'kitchen_board')::boolean, true, 'staff device reads A entitlements');
select throws_ok($$select public.get_entitlements(md5('shop:b')::uuid)$$, 'P0001', 'forbidden', 'staff device cannot read B');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:admin')::uuid, 'role', 'authenticated')::text, true);
select lives_ok($$select public.get_entitlements(md5('shop:a')::uuid), public.get_entitlements(md5('shop:b')::uuid)$$, 'admin reads both');

-- Shop B: Pro
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
select is((public.get_entitlements(md5('shop:b')::uuid) -> 'features' ->> 'combos')::boolean, true, 'B has combos');
select is(public.get_entitlements(md5('shop:b')::uuid) -> 'limits' -> 'max_tables', 'null'::jsonb, 'B max_tables unlimited (json null)');
select is(public.has_feature(md5('shop:b')::uuid, 'takeaway'), true, 'has_feature on B takeaway');
select is(public.has_feature(md5('shop:a')::uuid, 'takeaway'), false, 'has_feature on A takeaway');
select is(public.has_feature(md5('shop:a')::uuid, 'no_such_key'), false, 'unknown key is false');

-- Overrides change the answer (written as postgres)
reset role;
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values
  (md5('shop:a')::uuid, 'takeaway', true, 'trial'),
  (md5('shop:b')::uuid, 'combos', false, 'switched off');
insert into public.shop_feature_overrides (shop_id, feature_key, limit_value, note) values
  (md5('shop:a')::uuid, 'max_tables', 20, 'bigger'),
  (md5('shop:a')::uuid, 'max_staff', null, 'unlimited');
select is(public.has_feature(md5('shop:a')::uuid, 'takeaway'), true, 'override turns a feature on for A');
select is(public.has_feature(md5('shop:b')::uuid, 'combos'), false, 'override turns a feature off for B');
select is(public.limit_of(md5('shop:a')::uuid, 'max_tables'), 20, 'override changes a limit');
select is(public.limit_of(md5('shop:a')::uuid, 'max_staff'), null, 'override with null limit means unlimited');

select * from finish();
rollback;
