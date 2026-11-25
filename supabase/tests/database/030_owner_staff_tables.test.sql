begin;
select plan(34);

-- Owner A: staff management (Basic: max_staff 3, seed has Aminah and Ravi)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select is(public.add_staff(md5('shop:a')::uuid, '  Mei  ', '4321') ->> 'name', 'Mei', 'add_staff returns the trimmed StaffRow');
select is((select count(*) from public.staff where shop_id = md5('shop:a')::uuid and active), 3::bigint, 'A now has 3 active staff');
select throws_ok($$select public.add_staff(md5('shop:a')::uuid, 'Dewi', '9999')$$, 'P0001', 'limit_reached', '4th staff on Basic: limit_reached');
select throws_ok($$select public.add_staff(md5('shop:a')::uuid, 'Dewi', '5678')$$, 'P0001', 'duplicate_pin', 'PIN of an active colleague: duplicate_pin (checked before the limit)');
select throws_ok($$select public.add_staff(md5('shop:a')::uuid, 'Dewi', '12')$$, 'P0001', 'invalid_input', 'PIN too short');
select throws_ok($$select public.add_staff(md5('shop:a')::uuid, 'Dewi', '12a4')$$, 'P0001', 'invalid_input', 'PIN with a letter');
select throws_ok($$select public.add_staff(md5('shop:a')::uuid, 'Dewi', '1234567')$$, 'P0001', 'invalid_input', 'PIN of 7 digits');
select throws_ok($$select public.add_staff(md5('shop:a')::uuid, '   ', '9999')$$, 'P0001', 'invalid_input', 'blank name');
select throws_ok($$select public.add_staff(md5('shop:a')::uuid, repeat('x', 41), '9999')$$, 'P0001', 'invalid_input', 'name over 40 characters');
select throws_ok($$select public.add_staff(md5('shop:b')::uuid, 'Hana', '2468')$$, 'P0001', 'forbidden', 'owner A cannot add staff to shop B');

-- Deactivation removes the person's sessions; reactivation runs the limit trigger
reset role;
insert into public.staff_sessions (auth_uid, shop_id, staff_id, expires_at)
  values (md5('user:device-a')::uuid, md5('shop:a')::uuid, md5('staff:a:aminah')::uuid, now() + interval '8 hours');
set local role authenticated;
select lives_ok($$select public.update_staff(md5('staff:a:aminah')::uuid, null, false)$$, 'deactivate Aminah');
reset role;
select is((select count(*) from public.staff_sessions where staff_id = md5('staff:a:aminah')::uuid), 0::bigint, 'deactivation deleted her session');
set local role authenticated;
select lives_ok($$select public.add_staff(md5('shop:a')::uuid, 'Dewi', '9999')$$, 'a seat is free again');
select throws_ok($$select public.update_staff(md5('staff:a:aminah')::uuid, null, true)$$, 'P0001', 'limit_reached', 'reactivating at the limit: limit_reached');
select lives_ok($$select public.update_staff(md5('staff:a:ravi')::uuid, 'Ravi K')$$, 'rename Ravi');
select is((select name from public.staff where id = md5('staff:a:ravi')::uuid), 'Ravi K', 'name changed');
select throws_ok($$select public.update_staff(md5('staff:a:ravi')::uuid, '')$$, 'P0001', 'invalid_input', 'empty name refused');
select throws_ok($$select public.update_staff(md5('staff:b:siti')::uuid, 'X')$$, 'P0001', 'forbidden', 'owner A cannot edit B staff');
select throws_ok($$select public.update_staff(md5('staff:a:nobody')::uuid, 'X')$$, 'P0001', 'not_found', 'unknown staff: not_found');

-- set_staff_pin
select lives_ok($$select public.set_staff_pin(md5('staff:a:ravi')::uuid, '8888')$$, 'set_staff_pin');
select lives_ok($$select public.set_staff_pin(md5('staff:a:ravi')::uuid, '8888')$$, 'setting your own current PIN again is fine');
select throws_ok($$select public.set_staff_pin(md5('staff:a:ravi')::uuid, '4321')$$, 'P0001', 'duplicate_pin', 'colleague PIN: duplicate_pin');
select throws_ok($$select public.set_staff_pin(md5('staff:a:ravi')::uuid, '88')$$, 'P0001', 'invalid_input', 'bad PIN');
select throws_ok($$select public.set_staff_pin(md5('staff:b:siti')::uuid, '1357')$$, 'P0001', 'forbidden', 'owner A cannot reset a B PIN');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select is(public.claim_staff_session('kopitiam-teras', '8888') -> 'session' ->> 'staffName', 'Ravi K', 'the new PIN signs Ravi in');
select is(public.claim_staff_session('kopitiam-teras', '5678') ->> 'error', 'invalid_pin', 'the old PIN no longer works');

-- Nobody signed in, and an outsider
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.add_staff(md5('shop:a')::uuid, 'Zed', '1111')$$, 'P0001', 'not_signed_in', 'not signed in');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:outsider')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select public.add_staff(md5('shop:a')::uuid, 'Zed', '1111')$$, 'P0001', 'forbidden', 'outsider: forbidden');

-- regenerate_table_token: the old QR stops working
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
create temp table _tok as select public.regenerate_table_token(md5('table:a:03')::uuid) as r;
grant select on _tok to anon;
select isnt((select r ->> 'token' from _tok), 'lapar-local-a-table-03', 'a new token was issued');
select is((select r ->> 'label' from _tok), 'Table 3', 'TableRow label');
set local role anon;
select throws_ok($$select public.get_menu('lapar-local-a-table-03')$$, 'P0001', 'not_found', 'old token: not_found in get_menu');
select lives_ok($$select public.get_menu((select r ->> 'token' from _tok))$$, 'new token works in get_menu');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.regenerate_table_token(md5('table:a:04')::uuid)$$, 'P0001', 'forbidden', 'owner B cannot regenerate an A table');
select throws_ok($$select public.regenerate_table_token(md5('table:a:99')::uuid)$$, 'P0001', 'not_found', 'unknown table: not_found');

select * from finish();
rollback;
