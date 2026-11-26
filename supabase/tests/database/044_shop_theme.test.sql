begin;
select plan(11);

select is((select theme from public.shops where id = md5('shop:a')::uuid), 'kopitiam', 'default theme is kopitiam');
select throws_ok($$update public.shops set theme = 'neon' where id = md5('shop:a')::uuid$$, '23514', null, 'an unknown theme is rejected');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
select lives_ok($$update public.shops set theme = 'pandan' where id = md5('shop:b')::uuid$$, 'owner updates own shop theme');
update public.shops set theme = 'malam' where id = md5('shop:a')::uuid;
reset role;
select is((select theme from public.shops where id = md5('shop:b')::uuid), 'pandan', 'own theme saved');
select is((select theme from public.shops where id = md5('shop:a')::uuid), 'kopitiam', 'another shop theme untouched');

select is(public.get_menu('lapar-local-b-table-01') #>> '{shop,theme}', 'pandan', 'get_menu returns theme');
select is(public.get_pickup_board('lapar-local-b-pickup-01') ->> 'theme', 'pandan', 'get_pickup_board returns theme');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-b')::uuid, 'role', 'authenticated')::text, true);
select is(public.claim_staff_session('RCTH8W5N', '2468') -> 'session' ->> 'shopTheme', 'pandan', 'claim_staff_session returns shopTheme');
select is(public.my_staff_session() ->> 'shopTheme', 'pandan', 'my_staff_session returns shopTheme');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-b')::uuid, 'role', 'authenticated')::text, true);
select is(public.my_shops() -> 0 ->> 'theme', 'pandan', 'my_shops returns theme');
reset role;
select is((select count(*) from public.shops where theme not in ('kopitiam', 'pandan', 'teh-tarik', 'malam')), 0::bigint, 'only known themes stored');

select * from finish();
rollback;
