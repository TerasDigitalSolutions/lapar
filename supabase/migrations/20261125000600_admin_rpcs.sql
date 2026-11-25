-- Lapar admin RPCs (M4-A): Teras admin, DATA-MODEL 6.6. First line of each: assert_admin().

create function public.admin_list_shops() returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'slug', s.slug, 'planId', s.plan_id, 'active', s.active,
      'createdAt', s.created_at,
      'lastOrderAt', (select max(o.created_at) from public.orders o where o.shop_id = s.id),
      'ownerEmails', coalesce((select jsonb_agg(u.email order by u.email)
        from public.shop_owners so join auth.users u on u.id = so.user_id where so.shop_id = s.id), '[]'::jsonb),
      'overrides', coalesce((select jsonb_agg(jsonb_build_object(
          'key', ov.feature_key, 'enabled', ov.enabled, 'limitValue', ov.limit_value, 'note', ov.note,
          'changedByEmail', cu.email, 'changedAt', ov.changed_at) order by ov.feature_key)
        from public.shop_feature_overrides ov left join auth.users cu on cu.id = ov.changed_by
        where ov.shop_id = s.id), '[]'::jsonb),
      'entitlements', public.entitlements_of(s.id)
    ) order by s.created_at, s.name) from public.shops s
  ), '[]'::jsonb);
end $$;

create function public.admin_create_shop(p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = '' volatile
as $$
declare v_id uuid; v_cat uuid;
begin
  perform public.assert_admin();
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'invalid_input' using detail = 'name';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$' then
    raise exception 'invalid_input' using detail = 'slug';
  end if;
  if exists (select 1 from public.shops where slug = p_slug) then
    raise exception 'slug_taken' using detail = 'slug';
  end if;
  insert into public.shops (name, slug) values (btrim(p_name), p_slug) returning id into v_id;
  insert into public.stations (shop_id, name) values (v_id, 'Kitchen');
  insert into public.categories (shop_id, name) values (v_id, 'Drinks') returning id into v_cat;
  update public.shops set nudge_category_id = v_cat where id = v_id;
  return v_id;
end $$;

create function public.admin_set_plan(p_shop_id uuid, p_plan_id text) returns void
language plpgsql security definer set search_path = '' volatile
as $$
begin
  perform public.assert_admin();
  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'invalid_input' using detail = 'plan_id';
  end if;
  update public.shops set plan_id = p_plan_id where id = p_shop_id;
  if not found then raise exception 'not_found' using detail = 'shop'; end if;
end $$;

create function public.admin_set_override(
  p_shop_id uuid, p_key text, p_enabled boolean, p_limit_value int, p_note text
) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare v_kind text;
begin
  perform public.assert_admin();
  if not exists (select 1 from public.shops where id = p_shop_id) then
    raise exception 'not_found' using detail = 'shop';
  end if;
  select kind into v_kind from public.entitlement_keys where key = p_key;
  if v_kind is null then raise exception 'invalid_input' using detail = 'key'; end if;
  if p_note is null or char_length(p_note) not between 1 and 200 then
    raise exception 'invalid_input' using detail = 'note';
  end if;
  if v_kind = 'feature' then
    if p_enabled is null then raise exception 'invalid_input' using detail = 'enabled'; end if;
    p_limit_value := null;
  else
    if p_limit_value < 0 then raise exception 'invalid_input' using detail = 'limit_value'; end if;
    p_enabled := null;
  end if;
  insert into public.shop_feature_overrides (shop_id, feature_key, enabled, limit_value, note, changed_by, changed_at)
  values (p_shop_id, p_key, p_enabled, p_limit_value, p_note, auth.uid(), now())
  on conflict (shop_id, feature_key) do update
    set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note,
        changed_by = excluded.changed_by, changed_at = excluded.changed_at;
end $$;

create function public.admin_clear_override(p_shop_id uuid, p_key text) returns void
language plpgsql security definer set search_path = '' volatile
as $$
begin
  perform public.assert_admin();
  delete from public.shop_feature_overrides where shop_id = p_shop_id and feature_key = p_key;
end $$;

create function public.admin_set_shop_active(p_shop_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' volatile
as $$
begin
  perform public.assert_admin();
  if p_active is null then raise exception 'invalid_input' using detail = 'active'; end if;
  update public.shops set active = p_active where id = p_shop_id;
  if not found then raise exception 'not_found' using detail = 'shop'; end if;
end $$;

create function public.admin_get_platform_settings() returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_admin();
  return (select jsonb_build_object('whatsappNumber', whatsapp_number) from public.platform_settings);
end $$;

create function public.admin_set_platform_settings(p_whatsapp_number text) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare v text;
begin
  perform public.assert_admin();
  v := regexp_replace(coalesce(p_whatsapp_number, ''), '[ +-]', '', 'g');
  if v = '' then v := null;
  elsif v !~ '^[0-9]{8,15}$' then raise exception 'invalid_input' using detail = 'whatsapp_number';
  end if;
  update public.platform_settings set whatsapp_number = v, updated_at = now(), updated_by = auth.uid();
end $$;

grant execute on function
  public.admin_list_shops(), public.admin_create_shop(text, text), public.admin_set_plan(uuid, text),
  public.admin_set_override(uuid, text, boolean, int, text), public.admin_clear_override(uuid, text),
  public.admin_set_shop_active(uuid, boolean), public.admin_get_platform_settings(),
  public.admin_set_platform_settings(text)
  to authenticated;
