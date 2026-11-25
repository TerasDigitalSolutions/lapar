-- PostgREST sessions load pg-safeupdate, which rejects UPDATE/DELETE without a WHERE
-- clause (error 21000). Tests here can't load it, so check every function's source.
begin;
select plan(3);

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                lateral regexp_matches(p.prosrc, '(\mupdate\s+public\.\w+\s+set[^;]*;)', 'gi') m
           where n.nspname = 'public' and m[1] !~* '\mwhere\M'), 0::bigint,
  'no function in public runs UPDATE without WHERE');

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                lateral regexp_matches(p.prosrc, '(\mdelete\s+from\s+public\.\w+[^;]*;)', 'gi') m
           where n.nspname = 'public' and m[1] !~* '\mwhere\M'), 0::bigint,
  'no function in public runs DELETE without WHERE');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:admin')::uuid, 'role', 'authenticated')::text, true);
select lives_ok($$select public.admin_set_platform_settings('+60 12-345 6789')$$,
  'admin can save the WhatsApp number');

select * from finish();
rollback;
