begin;
select plan(31);

-- Fixture sessions (as postgres): device-a is Aminah at shop A (live), device-b is Ravi at shop A (expired for now).
insert into public.staff_sessions (auth_uid, shop_id, staff_id, expires_at) values
  (md5('user:device-a')::uuid, md5('shop:a')::uuid, md5('staff:a:aminah')::uuid, now() + interval '1 hour'),
  (md5('user:device-b')::uuid, md5('shop:a')::uuid, md5('staff:a:ravi')::uuid, now() - interval '1 minute');

-- Helpers only read request.jwt.claims (they are security definer), so no role switch is needed here.
create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claims', case when p is null then '' else json_build_object('sub', md5('user:' || p)::uuid, 'role', 'authenticated')::text end, true) $$;

-- current_shop_ids
select pg_temp.as_user('owner-a');
select results_eq($$select * from public.current_shop_ids()$$, $$values (md5('shop:a')::uuid)$$, 'owner A sees shop A only');
select pg_temp.as_user('owner-b');
select results_eq($$select * from public.current_shop_ids()$$, $$values (md5('shop:b')::uuid)$$, 'owner B sees shop B only');
select pg_temp.as_user('device-a');
select results_eq($$select * from public.current_shop_ids()$$, $$values (md5('shop:a')::uuid)$$, 'live staff session sees its shop');
select pg_temp.as_user('device-b');
select is_empty($$select * from public.current_shop_ids()$$, 'expired staff session sees nothing');
update public.staff_sessions set expires_at = now() + interval '1 hour' where auth_uid = md5('user:device-b')::uuid;
update public.staff set active = false where id = md5('staff:a:ravi')::uuid;
select is_empty($$select * from public.current_shop_ids()$$, 'deactivated staff session sees nothing');
update public.staff set active = true where id = md5('staff:a:ravi')::uuid;
select results_eq($$select * from public.current_shop_ids()$$, $$values (md5('shop:a')::uuid)$$, 'reactivated staff sees shop A');
select pg_temp.as_user('outsider');
select is_empty($$select * from public.current_shop_ids()$$, 'outsider sees nothing');
select pg_temp.as_user(null);
select is_empty($$select * from public.current_shop_ids()$$, 'no user sees nothing');

-- is_member / is_owner / is_platform_admin / current_staff_id
select pg_temp.as_user('owner-a');
select ok(public.is_owner(md5('shop:a')::uuid) and public.is_member(md5('shop:a')::uuid), 'owner A is owner and member of A');
select ok(not public.is_owner(md5('shop:b')::uuid) and not public.is_member(md5('shop:b')::uuid), 'owner A is neither for B');
select is(public.current_staff_id(md5('shop:a')::uuid), null, 'owner has no staff id');
select ok(not public.is_platform_admin(), 'owner is not a platform admin');
select pg_temp.as_user('device-a');
select ok(public.is_member(md5('shop:a')::uuid) and not public.is_owner(md5('shop:a')::uuid), 'staff device is member, not owner');
select is(public.current_staff_id(md5('shop:a')::uuid), md5('staff:a:aminah')::uuid, 'staff device resolves to Aminah');
select is(public.current_staff_id(md5('shop:b')::uuid), null, 'no staff id in another shop');
select pg_temp.as_user('admin');
select ok(public.is_platform_admin(), 'admin is a platform admin');

-- assert_*
select pg_temp.as_user(null);
select throws_ok($$select public.assert_member(md5('shop:a')::uuid)$$, 'P0001', 'not_signed_in', 'assert_member without user: not_signed_in');
select throws_ok($$select public.assert_admin()$$, 'P0001', 'not_signed_in', 'assert_admin without user: not_signed_in');
select pg_temp.as_user('outsider');
select throws_ok($$select public.assert_member(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'assert_member outsider: forbidden');
select pg_temp.as_user('device-a');
select lives_ok($$select public.assert_member(md5('shop:a')::uuid)$$, 'assert_member staff: ok');
select throws_ok($$select public.assert_owner(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'assert_owner staff: forbidden');
select throws_ok($$select public.assert_admin()$$, 'P0001', 'forbidden', 'assert_admin staff: forbidden');
select pg_temp.as_user('admin');
select lives_ok($$select public.assert_admin()$$, 'assert_admin admin: ok');
select pg_temp.as_user('owner-a');
select lives_ok($$select public.assert_owner(md5('shop:a')::uuid)$$, 'assert_owner owner: ok');
select throws_ok($$select public.assert_owner(md5('shop:b')::uuid)$$, 'P0001', 'forbidden', 'assert_owner other shop: forbidden');
select throws_ok($$select public.assert_feature(md5('shop:a')::uuid, 'combos')$$, 'P0001', 'feature_not_enabled', 'assert_feature off: feature_not_enabled');
select lives_ok($$select public.assert_feature(md5('shop:b')::uuid, 'combos')$$, 'assert_feature on: ok');

-- limits and station helpers
select is(public.limit_of(md5('shop:a')::uuid, 'max_tables'), 15, 'basic max_tables 15');
select is(public.limit_of(md5('shop:b')::uuid, 'max_tables'), null, 'pro max_tables unlimited');
select ok(public.within_limit(md5('shop:a')::uuid, 'max_tables', 14) and not public.within_limit(md5('shop:a')::uuid, 'max_tables', 15), 'within_limit boundary');
select is(public.default_station(md5('shop:b')::uuid), md5('station:b:kitchen')::uuid, 'default station is the first by sort');

select * from finish();
rollback;
