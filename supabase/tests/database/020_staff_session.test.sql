begin;
select plan(41);

create temp table _r (k text primary key, r jsonb);
grant all on _r to authenticated;

-- Devices: device-a (shop A), device-b (shop B), outsider (no shop), owner-a
set local role authenticated;

-- No caller
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select public.claim_staff_session('KTRS-7Q4M', '1234')$$, 'P0001', 'not_signed_in', 'claim without auth.uid(): not_signed_in');
select throws_ok($$select public.my_staff_session()$$, 'P0001', 'not_signed_in', 'my_staff_session without auth.uid(): not_signed_in');
select throws_ok($$select public.end_staff_session()$$, 'P0001', 'not_signed_in', 'end_staff_session without auth.uid(): not_signed_in');
select throws_ok($$select public.my_shops()$$, 'P0001', 'not_signed_in', 'my_shops without auth.uid(): not_signed_in');

select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select is(public.claim_staff_session('kopitiam-teras', '1234'), '{"ok": false, "error": "invalid_code"}'::jsonb, 'the public slug is not a staff code');
select is(public.my_staff_session(), null::jsonb, 'no session yet: my_staff_session is null');

-- Feature gate
reset role;
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:a')::uuid, 'staff_pins', false, 'test');
set local role authenticated;
select throws_ok($$select public.claim_staff_session('KTRS-7Q4M', '1234')$$, 'P0001', 'feature_not_enabled', 'staff_pins off: feature_not_enabled');
reset role;
delete from public.shop_feature_overrides where shop_id = md5('shop:a')::uuid;
set local role authenticated;

-- Wrong PINs are returned, never raised, and the counter persists
insert into _r select 'w1', public.claim_staff_session('KTRS-7Q4M', '0000');
select is((select r from _r where k = 'w1'), '{"ok": false, "error": "invalid_pin"}'::jsonb, 'wrong PIN: {ok:false, invalid_pin}');
insert into _r select 'w2', public.claim_staff_session('KTRS-7Q4M', '12');
select is((select r ->> 'error' from _r where k = 'w2'), 'invalid_pin', 'PIN with the wrong format counts as wrong');
reset role;
select is((select failures from public.pin_attempts where shop_id = md5('shop:a')::uuid), 2, 'two failures persisted');
select is((select count(*) from public.staff_sessions where auth_uid = md5('user:device-a')::uuid), 0::bigint, 'no session after wrong PINs');
set local role authenticated;
insert into _r select 'w3', public.claim_staff_session('KTRS-7Q4M', 'abcd');
insert into _r select 'w4', public.claim_staff_session('KTRS-7Q4M', '9999');
insert into _r select 'w5', public.claim_staff_session('KTRS-7Q4M', '8888');
select is((select r ->> 'error' from _r where k = 'w4'), 'invalid_pin', 'fourth wrong PIN: still invalid_pin');
select is((select r ->> 'error' from _r where k = 'w5'), 'pin_locked', 'fifth wrong PIN: pin_locked');
select ok((select (r ->> 'lockedUntil')::timestamptz between now() + interval '9 minutes 50 seconds' and now() + interval '10 minutes 5 seconds'
           from _r where k = 'w5'), 'locked for about 10 minutes');
reset role;
select ok((select locked_until > now() and failures = 0 from public.pin_attempts where shop_id = md5('shop:a')::uuid), 'lock persisted, failures reset');
set local role authenticated;

-- Right PIN while locked
insert into _r select 'locked', public.claim_staff_session('KTRS-7Q4M', '1234');
select is((select r ->> 'error' from _r where k = 'locked'), 'pin_locked', 'right PIN while locked: pin_locked');
select ok((select r ? 'lockedUntil' from _r where k = 'locked'), 'locked result carries lockedUntil');
reset role;
select is((select count(*) from public.staff_sessions where auth_uid = md5('user:device-a')::uuid), 0::bigint, 'no session while locked');

-- The lock is per shop: shop B is unaffected
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-b')::uuid, 'role', 'authenticated')::text, true);
insert into _r select 'siti', public.claim_staff_session('RCTH8W5N', '2468');
select is((select r ->> 'ok' from _r where k = 'siti'), 'true', 'shop B PIN works while shop A is locked');
select is((select r -> 'session' ->> 'staffName' from _r where k = 'siti'), 'Siti', 'session names the staff member');
select is((select r -> 'session' ->> 'pickupBoardToken' from _r where k = 'siti'), 'lapar-local-b-pickup-01', 'Pro shop session carries the pickup board token');
select is(public.my_staff_session() ->> 'shopName', 'Restoran Contoh', 'my_staff_session carries the shop name');
select is(public.my_staff_session() ->> 'pickupBoardToken', 'lapar-local-b-pickup-01', 'my_staff_session carries the pickup board token');

-- Lock expires
reset role;
update public.pin_attempts set locked_until = now() - interval '1 minute' where shop_id = md5('shop:a')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
insert into _r select 'ok', public.claim_staff_session('KTRS-7Q4M', '1234');
select is((select r ->> 'ok' from _r where k = 'ok'), 'true', 'after the lock: right PIN works');
select is((select r -> 'session' ->> 'staffName' from _r where k = 'ok'), 'Aminah', 'PIN 1234 is Aminah');
select ok((select (r -> 'session' ->> 'expiresAt')::timestamptz between now() + interval '15 hours 59 minutes' and now() + interval '16 hours 1 minute'
           from _r where k = 'ok'), 'session expires in about 16 h');
select is((select r -> 'session' ->> 'pickupBoardToken' from _r where k = 'ok'), null, 'Basic shop session: no pickup board token');
select is(public.my_staff_session() ->> 'shopSlug', 'kopitiam-teras', 'my_staff_session returns the live session');
reset role;
select is((select failures from public.pin_attempts where shop_id = md5('shop:a')::uuid), 0, 'a success resets failures');
select is((select locked_until from public.pin_attempts where shop_id = md5('shop:a')::uuid), null::timestamptz, 'an expired lock is cleared');

-- A different PIN on the same device replaces the session (one row per device)
set local role authenticated;
insert into _r select 'ravi', public.claim_staff_session('KTRS-7Q4M', '5678');
select is(public.my_staff_session() ->> 'staffName', 'Ravi', 'claiming again replaces the session');
reset role;
select is((select count(*) from public.staff_sessions where auth_uid = md5('user:device-a')::uuid), 1::bigint, 'still one session row per device');

-- PIN hashes are never stored in the clear
select ok((select not exists (select 1 from public.staff_pins where pin_hash in ('1234', '5678', '2468'))
           and (select pin_hash like '$2%' from public.staff_pins where staff_id = md5('staff:a:aminah')::uuid)), 'PINs are bcrypt hashes');

-- Failures before a success are cleared by the success; 3 wrong then right PIN
set local role authenticated;
insert into _r select 'x1', public.claim_staff_session('KTRS-7Q4M', '1111');
insert into _r select 'x2', public.claim_staff_session('KTRS-7Q4M', '2222');
insert into _r select 'x3', public.claim_staff_session('KTRS-7Q4M', '5678');
reset role;
select is((select failures from public.pin_attempts where shop_id = md5('shop:a')::uuid), 0, 'a success after wrong PINs resets the count');

-- Deactivated staff cannot claim or keep a session
update public.staff set active = false where id = md5('staff:a:ravi')::uuid;
set local role authenticated;
select is(public.my_staff_session(), null::jsonb, 'deactivated staff: session is no longer live');
insert into _r select 'dead', public.claim_staff_session('KTRS-7Q4M', '5678');
select is((select r ->> 'error' from _r where k = 'dead'), 'invalid_pin', 'deactivated staff PIN does not work');
reset role;
update public.staff set active = true where id = md5('staff:a:ravi')::uuid;

-- Expiry and end
update public.staff_sessions set expires_at = now() - interval '1 second' where auth_uid = md5('user:device-a')::uuid;
set local role authenticated;
select is(public.my_staff_session(), null::jsonb, 'expired session: my_staff_session null');
select lives_ok($$select public.end_staff_session()$$, 'end_staff_session runs');
reset role;
select is((select count(*) from public.staff_sessions where auth_uid = md5('user:device-a')::uuid), 0::bigint, 'end_staff_session deletes the row');

-- my_shops
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select is(public.my_shops(), jsonb_build_array(jsonb_build_object('id', md5('shop:a')::uuid, 'name', 'Kopitiam Teras', 'slug', 'kopitiam-teras',
  'active', true, 'planId', 'basic', 'theme', 'kopitiam')), 'my_shops lists the owned shop');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:outsider')::uuid, 'role', 'authenticated')::text, true);
select is(public.my_shops(), '[]'::jsonb, 'outsider owns no shops');

select * from finish();
rollback;
