begin;
select plan(26);

-- Fixtures: staff codes KTRS7Q4M (shop A, Basic), RCTH8W5N (shop B); device-a, device-b, owner-a, owner-b, outsider
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'claim_staff_session' and p.proargnames[1] = 'p_shop_slug'), 0::bigint, 'the slug version is gone');
select is((select staff_code from public.shops where id = md5('shop:a')::uuid), 'KTRS7Q4M', 'seed code');

select set_config('request.jwt.claims', json_build_object('sub', md5('user:admin')::uuid, 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table t_new as select public.admin_create_shop('Warung Kod', 'warung-kod') as id;
grant all on t_new to authenticated;
reset role;
select matches((select staff_code from public.shops where id = (select id from t_new)), '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', 'admin_create_shop gives a code from the safe alphabet');
select is((select count(*) from public.shops where staff_code is null or staff_code !~ '^[A-HJ-KM-NP-Z2-9]{8}$'), 0::bigint, 'every shop has a well-formed code');

-- Claim: code + PIN, normalised input
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select is(public.claim_staff_session('KTRS7Q4M', '1234') -> 'session' ->> 'staffName', 'Aminah', 'right code + PIN signs in');
select is(public.claim_staff_session(' ktrs-7q4m ', '5678') -> 'session' ->> 'staffName', 'Ravi', 'lowercase, dash and spaces are ignored');
select is(public.claim_staff_session('KT RS 7Q4M', '1234') ->> 'ok', 'true', 'spaces inside are ignored');

-- Unknown code: same shape, no counter touched, not even for a shop whose slug is given
select is(public.claim_staff_session('ZZZZ-ZZZZ', '1234'), '{"ok": false, "error": "invalid_code"}'::jsonb, 'unknown code: {ok:false, invalid_code}');
select is(public.claim_staff_session(null, '1234') ->> 'error', 'invalid_code', 'null code: invalid_code');
select is(public.claim_staff_session('restoran-contoh', '2468') ->> 'error', 'invalid_code', 'a slug is not a code');
select is(public.claim_staff_session('KTRS7Q4', '1234') ->> 'error', 'invalid_code', 'a short code is not a code');
reset role;
select is((select count(*) from public.pin_attempts where failures > 0 or locked_until is not null), 0::bigint, 'unknown codes touched no failure counter');

-- Lockout is per shop and only reachable with the code
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-b')::uuid, 'role', 'authenticated')::text, true);
do $$ begin for i in 1..5 loop perform public.claim_staff_session('KTRS7Q4M', '0000'); end loop; end $$;
select is(public.claim_staff_session('KTRS7Q4M', '1234') ->> 'error', 'pin_locked', 'five wrong PINs with the code lock shop A');
select is(public.claim_staff_session('RCTH-8W5N', '2468') ->> 'ok', 'true', 'shop B is not locked');

-- Anon cannot claim, read or regenerate
reset role;
set local role anon;
select throws_ok($$select public.claim_staff_session('KTRS7Q4M', '1234')$$, '42501', null, 'anon cannot claim');
select throws_ok($$select public.get_staff_code(md5('shop:a')::uuid)$$, '42501', null, 'anon cannot read the code');
select throws_ok($$select public.regenerate_staff_code(md5('shop:a')::uuid)$$, '42501', null, 'anon cannot regenerate');
select is(public.get_menu('lapar-local-a-table-01')::text ~* 'KTRS7Q4M|staff_?code', false, 'get_menu has no staff code');
reset role;

-- Owner read and regenerate; others refused
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.get_staff_code(md5('shop:a')::uuid)$$, 'P0001', 'forbidden', 'another shop owner cannot read it');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select is(public.get_staff_code(md5('shop:a')::uuid), 'KTRS7Q4M', 'owner reads the code');
select throws_ok($$select public.regenerate_staff_code(md5('shop:b')::uuid)$$, 'P0001', 'forbidden', 'another shop owner cannot regenerate');
reset role;
-- device-a has a live session (signed in above); regenerating ends every session of the shop, not other shops'
create temp table _c (code text);
grant all on _c to authenticated;
set local role authenticated;
insert into _c select public.regenerate_staff_code(md5('shop:a')::uuid);
reset role;
select ok((select code from _c) <> 'KTRS7Q4M' and (select code from _c) ~ '^[A-HJ-KM-NP-Z2-9]{8}$'
  and (select count(*) from public.staff_sessions where shop_id = md5('shop:a')::uuid) = 0
  and (select count(*) from public.staff_sessions where shop_id = md5('shop:b')::uuid) = 1, 'regenerate: new code, shop A sessions ended, shop B kept');
select is((select staff_code from public.shops where id = md5('shop:a')::uuid), (select code from _c), 'the new code is stored');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select is(public.claim_staff_session('KTRS7Q4M', '1234') ->> 'error', 'invalid_code', 'the old code stops working');

-- set_staff_pin ends that person's sessions only (Siti signed in on device-b)
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
select lives_ok($$select public.set_staff_pin(md5('staff:b:siti')::uuid, '2469')$$, 'owner resets Siti PIN');
reset role;
select is((select count(*) from public.staff_sessions where staff_id = md5('staff:b:siti')::uuid), 0::bigint, 'set_staff_pin ended her session');

select * from finish();
rollback;
