-- Lapar owner and Pro RPCs (M2-E): DATA-MODEL 6.4, 6.5, 10; helper assert_report_window; trigger auto_pairings_on_gain.
-- First line of each RPC: assert_owner(). Pro RPCs then assert_feature(). Internal helpers have no grants.
-- Depends only on 0100-0400 (not on 0600).

-- ---------------------------------------------------------------------------
-- Internal helpers (no grants)
-- ---------------------------------------------------------------------------
create function public.assert_report_window(p_shop uuid, p_day date) returns void
language plpgsql security definer set search_path = '' stable
as $$
declare v_n int := public.limit_of(p_shop, 'report_history_days');
begin
  if v_n is not null and p_day < public.myt_today() - (v_n - 1) then
    raise exception 'outside_report_window';
  end if;
end $$;

-- True when an active colleague (other than p_except) already has this PIN. Hashes are bcrypt, so compare by re-hashing.
create function public.pin_taken(p_shop uuid, p_pin text, p_except uuid) returns boolean
language sql security definer set search_path = '' stable
as $$
  select exists (
    select 1 from public.staff_pins sp
    join public.staff st on st.shop_id = sp.shop_id and st.id = sp.staff_id
    where sp.shop_id = p_shop and st.active and st.id is distinct from p_except
      and sp.pin_hash = extensions.crypt(p_pin, sp.pin_hash))
$$;

-- Sellable lines (D14): approved orders created in the MYT day range, lines not cancelled and not components.
-- d = MYT day, h = MYT hour of order creation.
create function public.sales_lines(p_shop uuid, p_from date, p_to date)
returns table (order_id uuid, tab_id uuid, d date, h int, item_id uuid, qty int, line_total_sen int, suggested_from_item_id uuid)
language sql security definer set search_path = '' stable
as $$
  select o.id, o.tab_id, (o.created_at at time zone 'Asia/Kuala_Lumpur')::date,
         extract(hour from o.created_at at time zone 'Asia/Kuala_Lumpur')::int,
         oi.item_id, oi.qty::int, oi.line_total_sen, oi.suggested_from_item_id
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.shop_id = p_shop and o.status = 'approved'
    and o.created_at >= p_from::timestamp at time zone 'Asia/Kuala_Lumpur'
    and o.created_at < (p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
    and oi.status <> 'cancelled' and oi.kind <> 'component'
$$;

-- TableRow
create function public.table_row_json(p_table uuid) returns jsonb
language sql security definer set search_path = '' stable
as $$
  select jsonb_build_object('id', t.id, 'shopId', t.shop_id, 'label', t.label, 'kind', t.kind, 'token', t.token,
    'active', t.active, 'sort', t.sort)
  from public.tables t where t.id = p_table
$$;

-- PromoRow
create function public.promo_row_json(p_promo uuid) returns jsonb
language sql security definer set search_path = '' stable
as $$
  select jsonb_build_object('id', p.id, 'shopId', p.shop_id, 'name', p.name, 'translations', p.translations,
    'discountType', p.discount_type, 'discountValue', p.discount_value, 'days', to_jsonb(p.days),
    'startTime', to_char(p.start_time, 'HH24:MI'), 'endTime', to_char(p.end_time, 'HH24:MI'), 'active', p.active,
    'itemIds', coalesce((select jsonb_agg(pi.item_id order by pi.item_id) from public.promo_items pi where pi.promo_id = p.id), '[]'::jsonb))
  from public.promos p where p.id = p_promo
$$;

-- MenuEditorDTO (all categories, items incl. inactive, groups, options, manual pairings, components, stations).
create function public.menu_editor_of(p_shop uuid) returns jsonb
language sql security definer set search_path = '' stable
as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'shopId', c.shop_id, 'name', c.name,
        'translations', c.translations, 'sort', c.sort,
        'window', case when c.available_from is not null then jsonb_build_object(
            'from', to_char(c.available_from, 'HH24:MI'), 'to', to_char(c.available_to, 'HH24:MI'),
            'days', to_jsonb(c.available_days)) end) order by c.sort, c.name, c.id)
      from public.categories c where c.shop_id = p_shop), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'shopId', i.shop_id, 'categoryId', i.category_id,
        'stationId', i.station_id, 'name', i.name, 'description', i.description, 'translations', i.translations,
        'priceSen', i.price_sen, 'photoUrl', i.photo_url, 'photoState', i.photo_state, 'active', i.active,
        'soldOut', i.sold_out, 'isCombo', i.is_combo, 'sort', i.sort) order by i.sort, i.name, i.id)
      from public.items i where i.shop_id = p_shop), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'shopId', g.shop_id, 'itemId', g.item_id,
        'name', g.name, 'translations', g.translations, 'minSelect', g.min_select, 'maxSelect', g.max_select,
        'sort', g.sort) order by g.sort, g.name, g.id)
      from public.modifier_groups g where g.shop_id = p_shop), '[]'::jsonb),
    'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'shopId', o.shop_id, 'groupId', o.group_id,
        'name', o.name, 'translations', o.translations, 'priceDeltaSen', o.price_delta_sen, 'sort', o.sort)
        order by o.sort, o.name, o.id)
      from public.modifier_options o where o.shop_id = p_shop), '[]'::jsonb),
    'pairings', coalesce((select jsonb_agg(jsonb_build_object('sourceItemId', p.source_item_id,
        'suggestedItemId', p.suggested_item_id, 'position', p.position) order by p.source_item_id, p.position)
      from public.item_pairings p where p.shop_id = p_shop), '[]'::jsonb),
    'comboComponents', coalesce((select jsonb_agg(jsonb_build_object('comboItemId', cc.combo_item_id,
        'itemId', cc.item_id, 'qty', cc.qty, 'sort', cc.sort) order by cc.combo_item_id, cc.sort)
      from public.combo_components cc where cc.shop_id = p_shop), '[]'::jsonb),
    'stations', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'shopId', s.shop_id, 'name', s.name,
        'sort', s.sort, 'active', s.active) order by s.sort, s.created_at, s.id)
      from public.stations s where s.shop_id = p_shop), '[]'::jsonb),
    'nudgeCategoryId', (select sh.nudge_category_id from public.shops sh where sh.id = p_shop))
$$;

-- ---------------------------------------------------------------------------
-- 6.4 Owner
-- ---------------------------------------------------------------------------
create function public.get_menu_editor(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_owner(p_shop_id);
  return public.menu_editor_of(p_shop_id);
end $$;

create function public.add_staff(p_shop_id uuid, p_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' volatile
as $$
declare v_name text := btrim(coalesce(p_name, '')); v_row public.staff;
begin
  perform public.assert_owner(p_shop_id);
  perform public.assert_feature(p_shop_id, 'staff_pins');
  if char_length(v_name) not between 1 and 40 then raise exception 'invalid_input' using detail = 'name'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then raise exception 'invalid_input' using detail = 'pin'; end if;
  if public.pin_taken(p_shop_id, p_pin, null) then raise exception 'duplicate_pin'; end if;
  insert into public.staff (shop_id, name) values (p_shop_id, v_name) returning * into v_row; -- limit trigger
  insert into public.staff_pins (staff_id, shop_id, pin_hash)
    values (v_row.id, p_shop_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)));
  return jsonb_build_object('id', v_row.id, 'shopId', v_row.shop_id, 'name', v_row.name, 'active', v_row.active,
    'createdAt', v_row.created_at);
end $$;

-- Reactivation cannot re-check duplicate PINs (only bcrypt hashes are stored); the owner can reset the PIN.
create function public.update_staff(p_staff_id uuid, p_name text default null, p_active boolean default null) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare v_st public.staff; v_name text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_st from public.staff where id = p_staff_id;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_owner(v_st.shop_id);
  if p_name is not null then
    v_name := btrim(p_name);
    if char_length(v_name) not between 1 and 40 then raise exception 'invalid_input' using detail = 'name'; end if;
  end if;
  update public.staff set name = coalesce(v_name, name), active = coalesce(p_active, active) where id = p_staff_id; -- limit trigger
  if p_active is false then delete from public.staff_sessions where staff_id = p_staff_id; end if;
end $$;

create function public.set_staff_pin(p_staff_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare v_st public.staff;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_st from public.staff where id = p_staff_id;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_owner(v_st.shop_id);
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then raise exception 'invalid_input' using detail = 'pin'; end if;
  if public.pin_taken(v_st.shop_id, p_pin, p_staff_id) then raise exception 'duplicate_pin'; end if;
  insert into public.staff_pins (staff_id, shop_id, pin_hash)
    values (p_staff_id, v_st.shop_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  on conflict (staff_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
end $$;

create function public.regenerate_table_token(p_table_id uuid) returns jsonb
language plpgsql security definer set search_path = '' volatile
as $$
declare v_shop uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select shop_id into v_shop from public.tables where id = p_table_id;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_owner(v_shop);
  update public.tables set token = public.new_token() where id = p_table_id;
  return public.table_row_json(p_table_id);
end $$;

create function public.set_item_pairings(p_item_id uuid, p_suggested uuid[]) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare v_shop uuid; v_ids uuid[] := coalesce(p_suggested, '{}');
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select shop_id into v_shop from public.items where id = p_item_id;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_owner(v_shop);
  perform public.assert_feature(v_shop, 'manual_pairings');
  if cardinality(v_ids) > 3
     or (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids)
     or p_item_id = any (v_ids)
     or exists (select 1 from unnest(v_ids) x where x is null or not exists (
          select 1 from public.items i where i.id = x and i.shop_id = v_shop)) then
    raise exception 'invalid_input' using detail = 'suggested';
  end if;
  delete from public.item_pairings where source_item_id = p_item_id;
  insert into public.item_pairings (shop_id, source_item_id, suggested_item_id, position)
    select v_shop, p_item_id, x, n::smallint from unnest(v_ids) with ordinality t (x, n);
end $$;

create function public.get_daily_summary(p_shop_id uuid, p_day date) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
declare v_sales bigint; v_orders bigint; v_bills bigint; v_top jsonb;
begin
  perform public.assert_owner(p_shop_id);
  perform public.assert_feature(p_shop_id, 'daily_summary');
  if p_day is null or p_day > public.myt_today() then raise exception 'invalid_input' using detail = 'day'; end if;
  perform public.assert_report_window(p_shop_id, p_day);
  select coalesce(sum(l.line_total_sen), 0), count(distinct l.order_id), count(distinct l.tab_id)
    into v_sales, v_orders, v_bills from public.sales_lines(p_shop_id, p_day, p_day) l;
  select coalesce(jsonb_agg(jsonb_build_object('itemId', t.item_id, 'name', t.name, 'qty', t.qty, 'revenueSen', t.rev)
      order by t.qty desc, t.rev desc, t.name), '[]'::jsonb)
    into v_top
  from (select l.item_id, i.name, sum(l.qty) qty, sum(l.line_total_sen) rev
        from public.sales_lines(p_shop_id, p_day, p_day) l join public.items i on i.id = l.item_id
        group by l.item_id, i.name order by sum(l.qty) desc, sum(l.line_total_sen) desc, i.name limit 5) t;
  return jsonb_build_object('day', p_day, 'salesSen', v_sales, 'orders', v_orders, 'bills', v_bills,
    'averageBillSen', case when v_bills > 0 then (2 * v_sales + v_bills) / (2 * v_bills) else 0 end, -- half up
    'topItems', v_top);
end $$;

create function public.get_shop_plan(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_owner(p_shop_id);
  return jsonb_build_object(
    'planId', (select s.plan_id from public.shops s where s.id = p_shop_id),
    'entitlements', public.entitlements_of(p_shop_id),
    'usage', jsonb_build_object(
      'tables', (select count(*) from public.tables t where t.shop_id = p_shop_id and t.active and t.kind = 'table'),
      'stations', (select count(*) from public.stations s where s.shop_id = p_shop_id and s.active),
      'staff', (select count(*) from public.staff s where s.shop_id = p_shop_id and s.active)),
    'askTerasWhatsapp', (select ps.whatsapp_number from public.platform_settings ps));
end $$;

-- ---------------------------------------------------------------------------
-- 6.5 Pro owner
-- ---------------------------------------------------------------------------
create function public.set_board_columns(p_station_id uuid, p_columns jsonb) returns jsonb
language plpgsql security definer set search_path = '' volatile
as $$
declare
  v_shop uuid;
  v_el jsonb; v_i int := 0;
  v_name text; v_status text; v_rank int; v_prev int := 0; v_id uuid;
  v_ids uuid[] := '{}'; v_seen boolean[] := array[false, false, false, false];
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select shop_id into v_shop from public.stations where id = p_station_id;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_owner(v_shop);
  perform public.assert_feature(v_shop, 'custom_columns');
  if p_columns is null or jsonb_typeof(p_columns) <> 'array' or jsonb_array_length(p_columns) not between 4 and 12 then
    raise exception 'invalid_input' using detail = 'columns';
  end if;
  -- Validate the whole list first (names, statuses, order, ids).
  for v_el in select value from jsonb_array_elements(p_columns) loop
    v_name := case when jsonb_typeof(v_el -> 'name') = 'string' then btrim(v_el ->> 'name') end;
    v_status := case when jsonb_typeof(v_el -> 'coreStatus') = 'string' then v_el ->> 'coreStatus' end;
    v_rank := array_position(array['new', 'preparing', 'cooking', 'ready'], v_status);
    if v_name is null or char_length(v_name) not between 1 and 24 or v_rank is null or v_rank < v_prev then
      raise exception 'invalid_input' using detail = 'columns';
    end if;
    v_prev := v_rank;
    v_seen[v_rank] := true;
    if jsonb_typeof(v_el -> 'id') = 'string' then
      v_id := public.try_uuid(v_el ->> 'id');
      if v_id is null or v_id = any (v_ids)
         or not exists (select 1 from public.board_columns c where c.id = v_id and c.station_id = p_station_id) then
        raise exception 'invalid_input' using detail = 'columns';
      end if;
      v_ids := v_ids || v_id;
    elsif jsonb_typeof(v_el -> 'id') not in ('null') and v_el ? 'id' then
      raise exception 'invalid_input' using detail = 'columns';
    end if;
  end loop;
  if not (v_seen[1] and v_seen[2] and v_seen[3] and v_seen[4]) then
    raise exception 'invalid_input' using detail = 'columns';
  end if;

  delete from public.board_columns where station_id = p_station_id and id <> all (v_ids); -- order lines fall back (set null)
  for v_el in select value from jsonb_array_elements(p_columns) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_el -> 'id') = 'string' then
      update public.board_columns set name = btrim(v_el ->> 'name'), core_status = (v_el ->> 'coreStatus')::public.item_status,
        sort = v_i - 1 where id = (v_el ->> 'id')::uuid;
    else
      insert into public.board_columns (shop_id, station_id, name, core_status, sort)
        values (v_shop, p_station_id, btrim(v_el ->> 'name'), (v_el ->> 'coreStatus')::public.item_status, v_i - 1);
    end if;
  end loop;
  -- A column re-typed to another status no longer fits the lines that sat in it.
  update public.order_items oi set column_id = null
    from public.board_columns c where c.id = oi.column_id and c.station_id = p_station_id and oi.status <> c.core_status;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'shopId', c.shop_id, 'stationId', c.station_id,
      'name', c.name, 'coreStatus', c.core_status, 'sort', c.sort) order by c.sort), '[]'::jsonb)
    from public.board_columns c where c.station_id = p_station_id);
end $$;

create function public.save_promo(p_promo jsonb) returns jsonb
language plpgsql security definer set search_path = '' volatile
as $$
declare
  v_shop uuid; v_id uuid; v_name text; v_type public.discount_type; v_value int; v_days smallint[];
  v_start time; v_end time; v_active boolean; v_trans jsonb; v_items uuid[];
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_promo is null or jsonb_typeof(p_promo) <> 'object' then raise exception 'invalid_input' using detail = 'promo'; end if;
  begin
    v_shop := (p_promo ->> 'shopId')::uuid;
  exception when data_exception then
    raise exception 'invalid_input' using detail = 'shop_id';
  end;
  if v_shop is null then raise exception 'invalid_input' using detail = 'shop_id'; end if;
  perform public.assert_owner(v_shop);
  perform public.assert_feature(v_shop, 'promos');
  begin
    v_name := btrim(coalesce(p_promo ->> 'name', ''));
    if char_length(v_name) not between 1 and 40 then raise exception 'invalid_input' using detail = 'name'; end if;
    if p_promo ->> 'discountType' not in ('percent', 'amount') then raise exception 'invalid_input' using detail = 'discount_type'; end if;
    v_type := (p_promo ->> 'discountType')::public.discount_type;
    if jsonb_typeof(p_promo -> 'discountValue') <> 'number'
       or (p_promo ->> 'discountValue')::numeric <> trunc((p_promo ->> 'discountValue')::numeric) then
      raise exception 'invalid_input' using detail = 'discount_value';
    end if;
    v_value := (p_promo ->> 'discountValue')::int;
    if v_value < 1 or (v_type = 'percent' and v_value > 100) then raise exception 'invalid_input' using detail = 'discount_value'; end if;
    if jsonb_typeof(p_promo -> 'days') <> 'array' then raise exception 'invalid_input' using detail = 'days'; end if;
    select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}') into v_days
      from jsonb_array_elements_text(p_promo -> 'days') d;
    if cardinality(v_days) = 0 or not (v_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then raise exception 'invalid_input' using detail = 'days'; end if;
    if coalesce(p_promo ->> 'startTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(p_promo ->> 'endTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or p_promo ->> 'startTime' = p_promo ->> 'endTime' then
      raise exception 'invalid_input' using detail = 'window';
    end if;
    v_start := (p_promo ->> 'startTime')::time;
    v_end := (p_promo ->> 'endTime')::time;
    v_active := coalesce((p_promo ->> 'active')::boolean, true);
    v_trans := coalesce(p_promo -> 'translations', '{}'::jsonb);
    if jsonb_typeof(v_trans) <> 'object' then raise exception 'invalid_input' using detail = 'translations'; end if;
    if jsonb_typeof(p_promo -> 'itemIds') is distinct from 'array' then raise exception 'invalid_input' using detail = 'item_ids'; end if;
    select coalesce(array_agg(distinct x::uuid), '{}') into v_items from jsonb_array_elements_text(p_promo -> 'itemIds') x;
    if exists (select 1 from unnest(v_items) x where not exists (select 1 from public.items i where i.id = x and i.shop_id = v_shop)) then
      raise exception 'invalid_input' using detail = 'item_ids';
    end if;
    if jsonb_typeof(p_promo -> 'id') = 'string' then v_id := (p_promo ->> 'id')::uuid; end if;
  exception when data_exception then
    raise exception 'invalid_input' using detail = 'promo';
  end;

  if v_id is not null then
    update public.promos set name = v_name, translations = v_trans, discount_type = v_type, discount_value = v_value,
      days = v_days, start_time = v_start, end_time = v_end, active = v_active
      where id = v_id and shop_id = v_shop;
    if not found then raise exception 'not_found'; end if;
  else
    insert into public.promos (shop_id, name, translations, discount_type, discount_value, days, start_time, end_time, active)
      values (v_shop, v_name, v_trans, v_type, v_value, v_days, v_start, v_end, v_active) returning id into v_id;
  end if;
  delete from public.promo_items where promo_id = v_id;
  insert into public.promo_items (shop_id, promo_id, item_id) select v_shop, v_id, x from unnest(v_items) x;
  return public.promo_row_json(v_id);
end $$;

create function public.set_combo_components(p_combo_item_id uuid, p_components jsonb) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare v_item public.items; v_el jsonb; v_ids uuid[] := '{}'; v_id uuid; v_qty int; v_n int := 0;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_item from public.items where id = p_combo_item_id;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_owner(v_item.shop_id);
  perform public.assert_feature(v_item.shop_id, 'combos');
  if not v_item.is_combo then raise exception 'invalid_input' using detail = 'combo_item_id'; end if;
  if p_components is null or jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) not between 1 and 6 then
    raise exception 'invalid_input' using detail = 'components';
  end if;
  begin
    for v_el in select value from jsonb_array_elements(p_components) loop
      v_id := (v_el ->> 'itemId')::uuid;
      if jsonb_typeof(v_el -> 'qty') <> 'number' or (v_el ->> 'qty')::numeric <> trunc((v_el ->> 'qty')::numeric) then
        raise exception 'invalid_input' using detail = 'components';
      end if;
      v_qty := (v_el ->> 'qty')::int;
      if v_id is null or v_id = any (v_ids) or v_qty not between 1 and 10
         or not exists (select 1 from public.items i where i.id = v_id and i.shop_id = v_item.shop_id and not i.is_combo) then
        raise exception 'invalid_input' using detail = 'components';
      end if;
      v_ids := v_ids || v_id;
    end loop;
  exception when data_exception then
    raise exception 'invalid_input' using detail = 'components';
  end;
  delete from public.combo_components where combo_item_id = p_combo_item_id;
  for v_el in select value from jsonb_array_elements(p_components) loop
    insert into public.combo_components (shop_id, combo_item_id, item_id, qty, sort)
      values (v_item.shop_id, p_combo_item_id, (v_el ->> 'itemId')::uuid, (v_el ->> 'qty')::int, v_n);
    v_n := v_n + 1;
  end loop;
end $$;

create function public.regenerate_pickup_board_token(p_shop_id uuid) returns text
language plpgsql security definer set search_path = '' volatile
as $$
declare v_token text;
begin
  perform public.assert_owner(p_shop_id);
  perform public.assert_feature(p_shop_id, 'takeaway');
  update public.shops set pickup_board_token = public.new_token() where id = p_shop_id returning pickup_board_token into v_token;
  return v_token;
end $$;

create function public.get_sales_report(p_shop_id uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
declare v_res jsonb; v_start timestamptz; v_end timestamptz;
begin
  perform public.assert_owner(p_shop_id);
  perform public.assert_feature(p_shop_id, 'full_reports');
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from + 1 > 366 then
    raise exception 'invalid_input' using detail = 'range';
  end if;
  perform public.assert_report_window(p_shop_id, p_from);
  v_start := p_from::timestamp at time zone 'Asia/Kuala_Lumpur';
  v_end := (p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur';
  with l as materialized (select * from public.sales_lines(p_shop_id, p_from, p_to)),
  prep as materialized (
    select oi.item_id, extract(epoch from (oi.ready_at - o.approved_at)) / 60.0 as m
    from public.order_items oi join public.orders o on o.id = oi.order_id
    where oi.shop_id = p_shop_id and o.status = 'approved' and o.approved_at is not null
      and oi.ready_at >= v_start and oi.ready_at < v_end and oi.status <> 'cancelled' and oi.kind <> 'combo'),
  prep_items as (
    select p.item_id, i.name, count(*) cnt, round(avg(p.m)::numeric, 1) avg_m,
      round((percentile_cont(0.5) within group (order by p.m))::numeric, 1) med_m
    from prep p join public.items i on i.id = p.item_id group by p.item_id, i.name)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'salesSen', (select coalesce(sum(line_total_sen), 0) from l),
    'orders', (select count(distinct order_id) from l),
    'bills', (select count(distinct tab_id) from l),
    'byDay', (select jsonb_agg(jsonb_build_object('day', g.day, 'salesSen', coalesce(x.s, 0), 'orders', coalesce(x.o, 0),
        'bills', coalesce(x.b, 0)) order by g.day)
      from (select p_from + n as day from generate_series(0, p_to - p_from) n) g
      left join (select d, sum(line_total_sen) s, count(distinct order_id) o, count(distinct tab_id) b from l group by d) x
        on x.d = g.day),
    'byHour', (select jsonb_agg(jsonb_build_object('hour', g.h, 'salesSen', coalesce(x.s, 0), 'orders', coalesce(x.o, 0)) order by g.h)
      from generate_series(0, 23) g (h)
      left join (select h, sum(line_total_sen) s, count(distinct order_id) o from l group by h) x on x.h = g.h),
    'items', coalesce((select jsonb_agg(jsonb_build_object('itemId', i.id, 'name', i.name, 'qty', coalesce(x.q, 0),
        'revenueSen', coalesce(x.r, 0)) order by coalesce(x.r, 0) desc, coalesce(x.q, 0) desc, i.name)
      from public.items i
      left join (select item_id, sum(qty) q, sum(line_total_sen) r from l group by item_id) x on x.item_id = i.id
      where i.shop_id = p_shop_id and i.active), '[]'::jsonb),
    'prep', coalesce((select jsonb_agg(jsonb_build_object('itemId', item_id, 'name', name, 'count', cnt,
        'avgMinutes', avg_m, 'medianMinutes', med_m) order by avg_m desc, name) from prep_items), '[]'::jsonb),
    'prepOverall', (select jsonb_build_object('count', count(*), 'avgMinutes', coalesce(round(avg(m)::numeric, 1), 0),
        'medianMinutes', coalesce(round((percentile_cont(0.5) within group (order by m))::numeric, 1), 0)) from prep))
  into v_res;
  return v_res;
end $$;

create function public.get_upsell_report(p_shop_id uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
declare v_first date; v_last date; v_n int; v_from date; v_res jsonb;
begin
  perform public.assert_owner(p_shop_id);
  perform public.assert_feature(p_shop_id, 'upsell_report');
  if p_month is null then raise exception 'invalid_input' using detail = 'month'; end if;
  v_first := p_month - (extract(day from p_month)::int - 1);
  v_last := (v_first + interval '1 month')::date - 1;
  v_n := public.limit_of(p_shop_id, 'report_history_days');
  v_from := greatest(v_first, case when v_n is not null then public.myt_today() - (v_n - 1) end);
  with l as materialized (select * from public.sales_lines(p_shop_id, v_from, v_last)),
  sug as (
    select suggested_from_item_id src, item_id dst, count(*) adds, sum(line_total_sen) rev
    from l where suggested_from_item_id is not null group by 1, 2),
  so as (select item_id, count(distinct order_id) n from l group by item_id)
  select jsonb_build_object('month', to_char(v_first, 'YYYY-MM'),
    'revenueSen', (select coalesce(sum(rev), 0) from sug),
    'adds', (select coalesce(sum(adds), 0) from sug),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('sourceItemId', s.src, 'sourceName', si.name,
        'suggestedItemId', s.dst, 'suggestedName', di.name, 'adds', s.adds, 'revenueSen', s.rev,
        'sourceOrders', coalesce(so.n, 0)) order by s.adds desc, s.rev desc, si.name, di.name)
      from sug s join public.items si on si.id = s.src join public.items di on di.id = s.dst
      left join so on so.item_id = s.src), '[]'::jsonb))
  into v_res;
  return v_res;
end $$;

create function public.export_shop_meta(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_owner(p_shop_id);
  perform public.assert_feature(p_shop_id, 'export_backup');
  return jsonb_build_object('version', 1, 'exportedAt', now(),
    'shop', (select jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'logoUrl', s.logo_url,
        'planId', s.plan_id, 'approvalMode', s.approval_mode, 'nudgeCategoryId', s.nudge_category_id,
        'active', s.active, 'pickupBoardToken', s.pickup_board_token, 'createdAt', s.created_at)
      from public.shops s where s.id = p_shop_id))
    || (public.menu_editor_of(p_shop_id) - 'nudgeCategoryId')
    || jsonb_build_object(
      'boardColumns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'shopId', c.shop_id,
          'stationId', c.station_id, 'name', c.name, 'coreStatus', c.core_status, 'sort', c.sort)
          order by c.station_id, c.sort) from public.board_columns c where c.shop_id = p_shop_id), '[]'::jsonb),
      'promos', coalesce((select jsonb_agg(public.promo_row_json(p.id) order by p.created_at, p.name, p.id)
          from public.promos p where p.shop_id = p_shop_id), '[]'::jsonb),
      'tables', coalesce((select jsonb_agg(public.table_row_json(t.id) order by t.sort, t.label, t.id)
          from public.tables t where t.shop_id = p_shop_id), '[]'::jsonb),
      'staff', coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'shopId', st.shop_id, 'name', st.name,
          'active', st.active, 'createdAt', st.created_at) order by st.created_at, st.name, st.id)
          from public.staff st where st.shop_id = p_shop_id), '[]'::jsonb));
end $$;

create function public.export_orders(p_shop_id uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
declare v_start timestamptz; v_end timestamptz;
begin
  perform public.assert_owner(p_shop_id);
  perform public.assert_feature(p_shop_id, 'export_backup');
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from + 1 > 93 then
    raise exception 'invalid_input' using detail = 'range';
  end if;
  v_start := p_from::timestamp at time zone 'Asia/Kuala_Lumpur';
  v_end := (p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur';
  return jsonb_build_object('from', p_from, 'to', p_to,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'createdAt', o.created_at,
        'approvedAt', o.approved_at, 'rejectedReason', o.rejected_reason, 'lines', public.staff_lines_of(o.id),
        'tabId', o.tab_id, 'tableLabel', tb.label, 'tableKind', tb.kind, 'pickupNo', t.pickup_no)
        order by o.created_at, o.id)
      from public.orders o join public.tabs t on t.id = o.tab_id join public.tables tb on tb.id = t.table_id
      where o.shop_id = p_shop_id and o.created_at >= v_start and o.created_at < v_end), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'method', p.method, 'amountSen', p.amount_sen,
        'roundingSen', p.rounding_sen, 'createdAt', p.created_at,
        'orderItemIds', (select coalesce(jsonb_agg(oi.id order by oi.created_at, oi.line_no), '[]'::jsonb)
                         from public.order_items oi where oi.paid_payment_id = p.id),
        'tabId', p.tab_id, 'tableLabel', tb.label) order by p.created_at, p.id)
      from public.tab_payments p join public.tabs t on t.id = p.tab_id join public.tables tb on tb.id = t.table_id
      where p.shop_id = p_shop_id and p.created_at >= v_start and p.created_at < v_end), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Auto pairings (D21): no client grant; called by cron, the gain trigger and the seed.
-- ---------------------------------------------------------------------------
create function public.refresh_auto_pairings(p_shop_id uuid default null) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare v_shop uuid;
begin
  if p_shop_id is null then -- shops that lost the feature keep no stale suggestions
    delete from public.auto_pairings a where not public.has_feature(a.shop_id, 'auto_pairings');
  end if;
  for v_shop in select s.id from public.shops s
    where (p_shop_id is null or s.id = p_shop_id) and public.has_feature(s.id, 'auto_pairings') loop
    delete from public.auto_pairings where shop_id = v_shop;
    with lines as (
      select distinct oi.order_id, oi.item_id
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      join public.items i on i.id = oi.item_id
      where oi.shop_id = v_shop and o.status = 'approved' and o.created_at > now() - interval '90 days'
        and oi.kind <> 'component' and oi.status <> 'cancelled' and i.active),
    cnt as (select item_id, count(*) n from lines group by item_id),
    pairs as (
      select a.item_id src, b.item_id dst, count(*) support
      from lines a join lines b on b.order_id = a.order_id and b.item_id <> a.item_id
      group by 1, 2 having count(*) >= 3),
    ranked as (
      select p.src, p.dst, p.support, p.support::real / c.n conf,
        row_number() over (partition by p.src order by p.support::real / c.n desc, p.support desc, p.dst) rn
      from pairs p join cnt c on c.item_id = p.src)
    insert into public.auto_pairings (shop_id, source_item_id, suggested_item_id, position, support, confidence)
      select v_shop, src, dst, rn::smallint, support::int, conf from ranked where rn <= 3;
  end loop;
end $$;

create function public.trg_auto_pairings_on_gain() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_shop uuid := (to_jsonb(new) ->> case tg_table_name when 'shops' then 'id' else 'shop_id' end)::uuid;
begin
  if public.has_feature(v_shop, 'auto_pairings') then perform public.refresh_auto_pairings(v_shop); end if;
  return new;
end $$;
create trigger auto_pairings_on_gain after insert or update on public.shop_feature_overrides
  for each row when (new.feature_key = 'auto_pairings') execute function public.trg_auto_pairings_on_gain();
create trigger auto_pairings_on_gain after update of plan_id on public.shops
  for each row when (old.plan_id is distinct from new.plan_id) execute function public.trg_auto_pairings_on_gain();

-- ---------------------------------------------------------------------------
-- Grants (section 7.1): every owner and Pro RPC; helpers and refresh_auto_pairings stay ungranted.
-- ---------------------------------------------------------------------------
grant execute on function
  public.get_menu_editor(uuid), public.add_staff(uuid, text, text), public.update_staff(uuid, text, boolean),
  public.set_staff_pin(uuid, text), public.regenerate_table_token(uuid), public.set_item_pairings(uuid, uuid[]),
  public.get_daily_summary(uuid, date), public.get_shop_plan(uuid),
  public.set_board_columns(uuid, jsonb), public.save_promo(jsonb), public.set_combo_components(uuid, jsonb),
  public.regenerate_pickup_board_token(uuid), public.get_sales_report(uuid, date, date),
  public.get_upsell_report(uuid, date), public.export_shop_meta(uuid), public.export_orders(uuid, date, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Nightly job (section 10): 03:30 MYT. If pg_cron is unavailable the schedule is skipped (D21 fallback:
-- call the same SQL from the nightly workflow); refresh_auto_pairings stays callable by the service role.
-- ---------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('lapar-nightly', '30 19 * * *',
    $job$select public.refresh_auto_pairings(); delete from public.staff_sessions where expires_at < now() - interval '1 day';$job$);
exception when others then
  raise notice 'pg_cron unavailable (%); lapar-nightly not scheduled', sqlerrm;
end $$;
