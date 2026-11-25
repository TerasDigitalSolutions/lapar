begin;
select plan(22);

create function pg_temp.cron_jobs() returns bigint language plpgsql as $$
begin
  if to_regclass('cron.job') is null then return -1; end if;
  return (select count(*) from cron.job where jobname = 'lapar-nightly');
end $$;

-- Privileges: the refresh has no client grant (the service role keeps the default)
select is(has_function_privilege('authenticated', 'public.refresh_auto_pairings(uuid)', 'execute'), false, 'authenticated cannot refresh');
select is(has_function_privilege('anon', 'public.refresh_auto_pairings(uuid)', 'execute'), false, 'anon cannot refresh');
select is(has_function_privilege('service_role', 'public.refresh_auto_pairings(uuid)', 'execute'), true, 'the service role can refresh');

-- The seed leaves auto_pairings empty (003 and 010 insert their own rows)
select is((select count(*) from public.auto_pairings), 0::bigint, 'the seed has no auto pairings');

select public.refresh_auto_pairings();
select is((select count(*) from public.auto_pairings where shop_id = md5('shop:a')::uuid), 0::bigint, 'Basic A gets nothing');
select ok(exists (select 1 from public.auto_pairings where source_item_id = md5('item:b:nasi-lemak')::uuid
                  and suggested_item_id = md5('item:b:teh-tarik')::uuid), 'B: nasi lemak -> teh tarik');
select is((select position from public.auto_pairings where source_item_id = md5('item:b:nasi-lemak')::uuid
                  and suggested_item_id = md5('item:b:teh-tarik')::uuid), 1::smallint, 'it is the top suggestion for nasi lemak');
select ok(exists (select 1 from public.auto_pairings where source_item_id = md5('item:b:kaya-toast')::uuid
                  and suggested_item_id = md5('item:b:half-boiled-eggs')::uuid), 'B: kaya toast -> half-boiled eggs');
select is((select max(c) from (select count(*) c from public.auto_pairings group by source_item_id) x) <= 3, true, 'at most three per source');
select is((select min(support) >= 3 and min(confidence) > 0 and max(confidence) <= 1 from public.auto_pairings), true, 'support >= 3, confidence in (0, 1]');
select is((select support from public.auto_pairings where source_item_id = md5('item:b:nasi-lemak')::uuid
                  and suggested_item_id = md5('item:b:teh-tarik')::uuid),
  (select count(*)::int from (select oi.order_id from public.order_items oi join public.orders o on o.id = oi.order_id
     where o.shop_id = md5('shop:b')::uuid and o.status = 'approved' and oi.kind <> 'component' and oi.status <> 'cancelled'
       and o.created_at > now() - interval '90 days' and oi.item_id in (md5('item:b:nasi-lemak')::uuid, md5('item:b:teh-tarik')::uuid)
     group by oi.order_id having count(distinct oi.item_id) = 2) t), 'support = orders containing both items');
select is((select count(*) from public.auto_pairings where source_item_id = suggested_item_id), 0::bigint, 'never paired with itself');

-- Enabling the feature on A by override fills it (trigger auto_pairings_on_gain)
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:a')::uuid, 'auto_pairings', true, 'test');
select ok(exists (select 1 from public.auto_pairings where shop_id = md5('shop:a')::uuid and source_item_id = md5('item:a:nasi-lemak')::uuid
                  and suggested_item_id = md5('item:a:teh-tarik')::uuid), 'A: override on fills nasi lemak -> teh tarik');
-- Another override key does not refresh anything
delete from public.auto_pairings where shop_id = md5('shop:a')::uuid;
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note) values (md5('shop:a')::uuid, 'takeaway', true, 'test');
select is((select count(*) from public.auto_pairings where shop_id = md5('shop:a')::uuid), 0::bigint, 'an unrelated override does not refresh');
-- Losing it: the nightly run clears stale rows
update public.shop_feature_overrides set enabled = false where shop_id = md5('shop:a')::uuid and feature_key = 'auto_pairings';
select public.refresh_auto_pairings();
select is((select count(*) from public.auto_pairings where shop_id = md5('shop:a')::uuid), 0::bigint, 'override off: no stale suggestions');
-- A plan change to Pro fills it (trigger on shops.plan_id)
delete from public.shop_feature_overrides where shop_id = md5('shop:a')::uuid and feature_key = 'auto_pairings';
update public.shops set plan_id = 'pro' where id = md5('shop:a')::uuid;
select ok((select count(*) from public.auto_pairings where shop_id = md5('shop:a')::uuid) > 0, 'upgrade to Pro fills auto pairings');
-- Inactive items drop out
update public.items set active = false where id = md5('item:b:teh-tarik')::uuid;
select public.refresh_auto_pairings(md5('shop:b')::uuid);
select is((select count(*) from public.auto_pairings where shop_id = md5('shop:b')::uuid
           and md5('item:b:teh-tarik')::uuid in (source_item_id, suggested_item_id)), 0::bigint, 'inactive items are not suggested');

-- get_menu lists manual suggestions first, then auto ones
update public.items set active = true where id = md5('item:b:teh-tarik')::uuid;
delete from public.item_pairings where source_item_id = md5('item:b:nasi-lemak')::uuid;
insert into public.item_pairings (shop_id, source_item_id, suggested_item_id, position)
  values (md5('shop:b')::uuid, md5('item:b:nasi-lemak')::uuid, md5('item:b:mee-rebus')::uuid, 1);
select public.refresh_auto_pairings(md5('shop:b')::uuid);
select is((select (i -> 'suggestions' -> 0 ->> 'itemId') from jsonb_array_elements(public.get_menu('lapar-local-b-table-01') -> 'items') i
           where i ->> 'name' = 'Nasi lemak'), md5('item:b:mee-rebus')::uuid::text, 'get_menu: manual suggestion first');
select is((select (i -> 'suggestions' -> 1 ->> 'itemId') from jsonb_array_elements(public.get_menu('lapar-local-b-table-01') -> 'items') i
           where i ->> 'name' = 'Nasi lemak'), md5('item:b:teh-tarik')::uuid::text, 'get_menu: the auto suggestion follows');

-- Cron
select is(pg_temp.cron_jobs(), 1::bigint, 'cron.job has lapar-nightly');
select is((select schedule from cron.job where jobname = 'lapar-nightly'), '30 19 * * *', 'every day at 03:30 MYT (19:30 UTC)');
insert into public.staff_sessions (auth_uid, shop_id, staff_id, expires_at)
  values (md5('user:device-a')::uuid, md5('shop:a')::uuid, md5('staff:a:aminah')::uuid, now() - interval '2 days'),
         (md5('user:device-b')::uuid, md5('shop:b')::uuid, md5('staff:b:siti')::uuid, now() + interval '2 hours');
do $$ begin execute (select command from cron.job where jobname = 'lapar-nightly'); end $$;
select is((select array_agg(auth_uid) from public.staff_sessions), array[md5('user:device-b')::uuid], 'the job also deletes sessions expired for over a day');

select * from finish();
rollback;
