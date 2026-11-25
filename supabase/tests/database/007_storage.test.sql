begin;
select plan(13);

-- Bucket
select is((select public from storage.buckets where id = 'menu-staging'), true, 'bucket menu-staging is public');
select is((select file_size_limit from storage.buckets where id = 'menu-staging'), 2097152::bigint, 'bucket limit is 2 MB');
select is((select allowed_mime_types from storage.buckets where id = 'menu-staging'), array['image/webp', 'image/jpeg'], 'bucket allows webp and jpeg only');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'menu_staging%'), 1::bigint, 'one menu-staging policy (insert only)');

insert into public.staff_sessions (auth_uid, shop_id, staff_id, expires_at) values
  (md5('user:device-a')::uuid, md5('shop:a')::uuid, md5('staff:a:aminah')::uuid, now() + interval '1 hour');

-- Owner A
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-staging', '%s/%s/a.webp')$$, md5('shop:a')::uuid, md5('item:a:kopi')::uuid),
  'owner A uploads into own item folder');
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-staging', '%s/logo/a.webp')$$, md5('shop:a')::uuid),
  'owner A uploads a logo');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-staging', '%s/%s/b.webp')$$, md5('shop:b')::uuid, md5('item:b:kopi')::uuid),
  '42501', null, 'owner A cannot upload into shop B''s folder');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('menu-staging', 'not-a-uuid/x.webp')$$, '42501', null, 'a non-uuid folder is refused');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('other-bucket', '%s/x.webp')$$, md5('shop:a')::uuid), '42501', null, 'other buckets are refused');
select is_empty($$update storage.objects set name = 'x' where bucket_id = 'menu-staging' returning 1$$, 'owner A updates nothing (no update policy)');

-- Staff device in A, outsider, anon
select set_config('request.jwt.claims', json_build_object('sub', md5('user:device-a')::uuid, 'role', 'authenticated')::text, true);
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-staging', '%s/c.webp')$$, md5('shop:a')::uuid),
  '42501', null, 'staff device (not owner) cannot upload');
select set_config('request.jwt.claims', json_build_object('sub', md5('user:outsider')::uuid, 'role', 'authenticated')::text, true);
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-staging', '%s/c.webp')$$, md5('shop:a')::uuid),
  '42501', null, 'outsider cannot upload');
reset role;
set local role anon;
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('menu-staging', '%s/c.webp')$$, md5('shop:a')::uuid),
  '42501', null, 'anon cannot upload');

select * from finish();
rollback;
