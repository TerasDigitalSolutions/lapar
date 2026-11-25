-- Lapar security (M2-B): helpers, entitlement functions, triggers, grants, RLS, realtime, storage.
-- See docs/DATA-MODEL.md sections 4, 5, 7, 8, 9. Deny by default: every grant below is explicit.

-- ---------------------------------------------------------------------------
-- Helpers (section 5). All security definer, search_path empty, schema-qualified.
-- ---------------------------------------------------------------------------
create function public.current_shop_ids() returns setof uuid
language sql security definer set search_path = '' stable
as $$
  select o.shop_id from public.shop_owners o where o.user_id = auth.uid()
  union
  select s.shop_id
  from public.staff_sessions s
  join public.staff st on st.shop_id = s.shop_id and st.id = s.staff_id
  where s.auth_uid = auth.uid() and s.expires_at > now() and st.active
$$;

create function public.is_member(p_shop uuid) returns boolean
language sql security definer set search_path = '' stable
as $$ select p_shop in (select public.current_shop_ids()) $$;

create function public.is_owner(p_shop uuid) returns boolean
language sql security definer set search_path = '' stable
as $$ select exists (select 1 from public.shop_owners o where o.shop_id = p_shop and o.user_id = auth.uid()) $$;

create function public.is_platform_admin() returns boolean
language sql security definer set search_path = '' stable
as $$ select exists (select 1 from public.platform_admins a where a.user_id = auth.uid()) $$;

create function public.current_staff_id(p_shop uuid) returns uuid
language sql security definer set search_path = '' stable
as $$
  select s.staff_id
  from public.staff_sessions s
  join public.staff st on st.shop_id = s.shop_id and st.id = s.staff_id
  where s.auth_uid = auth.uid() and s.shop_id = p_shop and s.expires_at > now() and st.active
$$;

create function public.entitlements_of(p_shop uuid) returns jsonb
language sql security definer set search_path = '' stable
as $$
  select jsonb_build_object(
    'features', coalesce(jsonb_object_agg(k.key, coalesce(o.enabled, pf.enabled, false)) filter (where k.kind = 'feature'), '{}'::jsonb),
    'limits', coalesce(jsonb_object_agg(k.key, case when o.feature_key is not null then o.limit_value else pf.limit_value end)
                       filter (where k.kind = 'limit'), '{}'::jsonb))
  from public.entitlement_keys k
  left join public.shops s on s.id = p_shop
  left join public.plan_features pf on pf.plan_id = s.plan_id and pf.feature_key = k.key
  left join public.shop_feature_overrides o on o.shop_id = p_shop and o.feature_key = k.key
$$;

create function public.get_entitlements(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if not (public.is_member(p_shop_id) or public.is_platform_admin()) then raise exception 'forbidden'; end if;
  return public.entitlements_of(p_shop_id);
end $$;

create function public.has_feature(p_shop uuid, p_key text) returns boolean
language sql security definer set search_path = '' stable
as $$ select coalesce((public.entitlements_of(p_shop) -> 'features' ->> p_key)::boolean, false) $$;

create function public.limit_of(p_shop uuid, p_key text) returns int
language sql security definer set search_path = '' stable
as $$ select (public.entitlements_of(p_shop) -> 'limits' ->> p_key)::int $$;

create function public.within_limit(p_shop uuid, p_key text, p_count bigint) returns boolean
language sql security definer set search_path = '' stable
as $$ select coalesce(p_count < public.limit_of(p_shop, p_key), true) $$;

create function public.default_station(p_shop uuid) returns uuid
language sql security definer set search_path = '' stable
as $$ select s.id from public.stations s where s.shop_id = p_shop and s.active order by s.sort, s.created_at limit 1 $$;

create function public.assert_member(p_shop uuid) returns void
language plpgsql security definer set search_path = '' stable
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if not public.is_member(p_shop) then raise exception 'forbidden'; end if;
end $$;

create function public.assert_owner(p_shop uuid) returns void
language plpgsql security definer set search_path = '' stable
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if not public.is_owner(p_shop) then raise exception 'forbidden'; end if;
end $$;

create function public.assert_admin() returns void
language plpgsql security definer set search_path = '' stable
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
end $$;

create function public.assert_feature(p_shop uuid, p_key text) returns void
language plpgsql security definer set search_path = '' stable
as $$
begin
  if not public.has_feature(p_shop, p_key) then
    raise exception 'feature_not_enabled' using detail = p_key;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers (section 4)
-- ---------------------------------------------------------------------------
create function public.trg_items_set_defaults() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.station_id := coalesce(new.station_id, public.default_station(new.shop_id));
  return new;
end $$;
create trigger items_set_defaults before insert on public.items
  for each row execute function public.trg_items_set_defaults();

create function public.trg_touch_updated_at() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger touch_updated_at before update on public.items
  for each row execute function public.trg_touch_updated_at();
create trigger touch_updated_at before update on public.service_requests
  for each row execute function public.trg_touch_updated_at();
create trigger touch_updated_at before update on public.tabs
  for each row execute function public.trg_touch_updated_at();

create function public.trg_enforce_limits() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := case tg_table_name when 'tables' then 'max_tables' when 'stations' then 'max_stations' else 'max_staff' end;
  v_count bigint;
begin
  if not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active then return new; end if;
  if tg_table_name = 'tables' and to_jsonb(new) ->> 'kind' <> 'table' then return new; end if; -- counters never count
  perform pg_advisory_xact_lock(hashtext('limits:' || new.shop_id));
  execute format('select count(*) from public.%I where shop_id = $1 and active and id <> $2 %s', tg_table_name,
                 case when tg_table_name = 'tables' then 'and kind = ''table''' else '' end)
    into v_count using new.shop_id, new.id;
  if not public.within_limit(new.shop_id, v_key, v_count) then
    raise exception 'limit_reached' using detail = v_key;
  end if;
  return new;
end $$;
create trigger enforce_limits before insert or update of active on public.tables
  for each row execute function public.trg_enforce_limits();
create trigger enforce_limits before insert or update of active on public.stations
  for each row execute function public.trg_enforce_limits();
create trigger enforce_limits before insert or update of active on public.staff
  for each row execute function public.trg_enforce_limits();

create function public.trg_counter_needs_takeaway() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'counter' and not public.has_feature(new.shop_id, 'takeaway') then
    raise exception 'feature_not_enabled' using detail = 'takeaway';
  end if;
  return new;
end $$;
create trigger counter_needs_takeaway before insert on public.tables
  for each row execute function public.trg_counter_needs_takeaway();

create function public.trg_combo_needs_feature() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_combo and not public.has_feature(new.shop_id, 'combos') then
    raise exception 'feature_not_enabled' using detail = 'combos';
  end if;
  return new;
end $$;
create trigger combo_needs_feature before insert or update of is_combo on public.items
  for each row execute function public.trg_combo_needs_feature();

create function public.trg_keep_one_station() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.active and not new.active and not exists (
    select 1 from public.stations s where s.shop_id = new.shop_id and s.active and s.id <> new.id) then
    raise exception 'invalid_input' using detail = 'last_station';
  end if;
  return new;
end $$;
create trigger keep_one_station before update of active on public.stations
  for each row execute function public.trg_keep_one_station();

-- ---------------------------------------------------------------------------
-- Function grants (section 7.1): only what exists now. Customer RPCs (anon) come in M2-C.
-- ---------------------------------------------------------------------------
grant execute on function
  public.current_shop_ids(), public.is_member(uuid), public.is_owner(uuid), public.is_platform_admin(),
  public.has_feature(uuid, text), public.get_entitlements(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Table grants and RLS policies (section 7.2). Policies are for authenticated only.
-- ---------------------------------------------------------------------------
-- Reference data, readable by any signed-in user.
grant select on public.entitlement_keys, public.plans, public.plan_features to authenticated;
create policy entitlement_keys_select on public.entitlement_keys for select to authenticated using (true);
create policy plans_select on public.plans for select to authenticated using (true);
create policy plan_features_select on public.plan_features for select to authenticated using (true);

grant select on public.platform_admins to authenticated;
create policy platform_admins_select on public.platform_admins for select to authenticated using (user_id = auth.uid());

-- No client grants: platform_settings, staff_pins, staff_sessions, pin_attempts, pickup_counters.

grant select on public.shops to authenticated;
grant update (name, logo_url, approval_mode, nudge_category_id) on public.shops to authenticated;
create policy shops_select on public.shops for select to authenticated using (id in (select public.current_shop_ids()));
create policy shops_update on public.shops for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

grant select on public.shop_owners to authenticated;
create policy shop_owners_select on public.shop_owners for select to authenticated
  using (user_id = auth.uid() or shop_id in (select public.current_shop_ids()));

grant select on public.shop_feature_overrides to authenticated;
create policy shop_feature_overrides_select on public.shop_feature_overrides for select to authenticated
  using (public.is_owner(shop_id));

do $$
declare t text;
begin
  -- Member-readable shop tables.
  foreach t in array array['staff','stations','categories','items','modifier_groups','modifier_options',
    'item_pairings','auto_pairings','combo_components','promo_items','board_columns','promos','tables',
    'tabs','orders','order_items','service_requests','tab_payments'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (shop_id in (select public.current_shop_ids()))',
      t || '_select', t);
  end loop;
  -- Owner writes (insert, update).
  foreach t in array array['stations','categories','items','modifier_groups','modifier_options'] loop
    execute format('grant insert, update on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_owner(shop_id))',
      t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_owner(shop_id)) with check (public.is_owner(shop_id))',
      t || '_update', t);
  end loop;
  -- Owner deletes.
  foreach t in array array['categories','modifier_groups','modifier_options','promos'] loop
    execute format('grant delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_owner(shop_id))',
      t || '_delete', t);
  end loop;
end $$;

-- Tables: column-limited writes (token and shop are never updatable).
grant insert (shop_id, label, kind, sort, active) on public.tables to authenticated;
grant update (label, sort, active) on public.tables to authenticated;
create policy tables_insert on public.tables for insert to authenticated with check (public.is_owner(shop_id));
create policy tables_update on public.tables for update to authenticated
  using (public.is_owner(shop_id)) with check (public.is_owner(shop_id));

-- ---------------------------------------------------------------------------
-- Realtime (section 8)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  alter publication supabase_realtime add table public.orders, public.order_items, public.service_requests, public.tabs;
end $$;

-- ---------------------------------------------------------------------------
-- Storage (section 9)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-staging', 'menu-staging', true, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

create policy menu_staging_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-staging' and public.is_owner(public.try_uuid((storage.foldername(name))[1])));
