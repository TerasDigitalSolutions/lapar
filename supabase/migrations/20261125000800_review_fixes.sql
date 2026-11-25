-- Review fixes (behaviour bugs found in review): pickup board, stale table tabs, call_server throttle,
-- empty set meals, overnight promo endsAt. Signatures, security definer and grants are unchanged.


create or replace function public.get_menu(p_table_token text) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
declare
  v_table public.tables;
  v_shop public.shops;
  v_f jsonb;
  v_lang boolean;
  v_promos boolean;
  v_timed boolean;
  v_combos boolean;
  v_base jsonb;
  v_categories jsonb;
  v_items jsonb;
begin
  select * into v_table from public.tables t where t.token = p_table_token and t.active;
  if not found then raise exception 'not_found'; end if;
  select * into v_shop from public.shops s where s.id = v_table.shop_id;
  v_f := public.entitlements_of(v_shop.id) -> 'features';
  v_lang := (v_f ->> 'multi_language_menu')::boolean;
  v_promos := (v_f ->> 'promos')::boolean;
  v_timed := (v_f ->> 'timed_menus')::boolean;
  v_combos := (v_f ->> 'combos')::boolean;

  v_base := jsonb_build_object(
    'shop', jsonb_build_object('id', v_shop.id, 'name', v_shop.name, 'slug', v_shop.slug, 'logoUrl', v_shop.logo_url,
      'active', v_shop.active,
      'nudgeCategoryId', case when (v_f ->> 'checkout_nudge')::boolean then v_shop.nudge_category_id end),
    'table', jsonb_build_object('label', v_table.label, 'kind', v_table.kind),
    'features', v_f,
    'serverNow', now());
  if not v_shop.active then
    return v_base || jsonb_build_object('categories', '[]'::jsonb, 'items', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name,
      'translations', case when v_lang then c.translations else '{}'::jsonb end,
      'sort', c.sort,
      'window', case when v_timed and c.available_from is not null then jsonb_build_object(
          'from', to_char(c.available_from, 'HH24:MI'), 'to', to_char(c.available_to, 'HH24:MI'),
          'days', to_jsonb(c.available_days)) end,
      'availableNow', not v_timed or c.available_from is null
          or public.in_window(c.available_from, c.available_to, c.available_days, now())
    ) order by c.sort, c.name), '[]'::jsonb)
  into v_categories
  from public.categories c where c.shop_id = v_shop.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'categoryId', i.category_id, 'name', i.name, 'description', i.description,
      'translations', case when v_lang then i.translations else '{}'::jsonb end,
      'priceSen', i.price_sen,
      'effectivePriceSen', coalesce(bp.price_sen, i.price_sen),
      'promo', case when pr.id is not null then jsonb_build_object('id', pr.id, 'name', pr.name,
          'translations', case when v_lang then pr.translations else '{}'::jsonb end,
          'endsAt', ((public.myt_today() + case when pr.end_time < pr.start_time
                    and (now() at time zone 'Asia/Kuala_Lumpur')::time >= pr.end_time then 1 else 0 end)::timestamp + pr.end_time)
                    at time zone 'Asia/Kuala_Lumpur') end,
      'photoUrl', i.photo_url, 'soldOut', i.sold_out, 'sort', i.sort,
      'groups', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', g.id, 'name', g.name,
            'translations', case when v_lang then g.translations else '{}'::jsonb end,
            'minSelect', g.min_select, 'maxSelect', g.max_select,
            'options', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', o.id, 'name', o.name,
                  'translations', case when v_lang then o.translations else '{}'::jsonb end,
                  'priceDeltaSen', o.price_delta_sen) order by o.sort, o.name), '[]'::jsonb)
                from public.modifier_options o where o.shop_id = g.shop_id and o.group_id = g.id)
          ) order by g.sort, g.name), '[]'::jsonb)
        from public.modifier_groups g where g.shop_id = i.shop_id and g.item_id = i.id),
      'suggestions', (select coalesce(jsonb_agg(jsonb_build_object('itemId', d.sid, 'source', d.src) order by d.ord), '[]'::jsonb)
        from (select distinct on (u.sid) u.sid, u.src, u.ord
              from (select pp.suggested_item_id sid, 'manual' src, pp.position::int ord from public.item_pairings pp
                    where pp.source_item_id = i.id and (v_f ->> 'manual_pairings')::boolean
                    union all
                    select ap.suggested_item_id, 'auto', 10 + ap.position from public.auto_pairings ap
                    where ap.source_item_id = i.id and (v_f ->> 'auto_pairings')::boolean) u
              join public.items si on si.id = u.sid and si.active
              order by u.sid, u.ord) d),
      'combo', case when v_combos and i.is_combo then jsonb_build_object('components',
          (select coalesce(jsonb_agg(jsonb_build_object('itemId', ci.id, 'name', ci.name,
              'translations', case when v_lang then ci.translations else '{}'::jsonb end, 'qty', cc.qty)
              order by cc.sort, ci.name), '[]'::jsonb)
           from public.combo_components cc join public.items ci on ci.shop_id = cc.shop_id and ci.id = cc.item_id
           where cc.shop_id = i.shop_id and cc.combo_item_id = i.id)) end
    ) order by c.sort, c.name, i.sort, i.name), '[]'::jsonb)
  into v_items
  from public.items i
  join public.categories c on c.shop_id = i.shop_id and c.id = i.category_id
  left join lateral (select b.promo_id, b.price_sen from public.best_promo(i.id, i.price_sen, now()) b where v_promos) bp on true
  left join public.promos pr on pr.id = bp.promo_id
  where i.shop_id = v_shop.id and i.active and (v_combos or not i.is_combo);

  return v_base || jsonb_build_object('categories', v_categories, 'items', v_items);
end $$;

create or replace function public.place_order(p_table_token text, p_lines jsonb, p_pickup_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_table public.tables;
  v_shop public.shops;
  v_f jsonb;
  v_counter boolean;
  v_tab public.tabs;
  v_order_id uuid;
  v_needs_approval boolean;
  v_mode public.approval_mode;
  v_line jsonb;
  v_line_no int := 0;
  v_item public.items;
  v_item_id uuid;
  v_qty int;
  v_note text;
  v_from uuid;
  v_opts uuid[];
  v_n_all int;
  v_n_ok int;
  v_opts_json jsonb;
  v_opts_price int;
  v_list int;
  v_unit int;
  v_promo uuid;
  v_station uuid;
  v_parent public.order_items;
  v_row public.order_items;
  v_comp record;
  v_priced jsonb := '[]'::jsonb;
  v_total int := 0;
  v_default_station uuid;
  v_multi boolean;
begin
  select * into v_table from public.tables t where t.token = p_table_token and t.active for update;
  if not found then raise exception 'not_found'; end if;
  select * into v_shop from public.shops s where s.id = v_table.shop_id;
  if not v_shop.active then raise exception 'shop_inactive'; end if;
  v_f := public.entitlements_of(v_shop.id) -> 'features';
  if not (v_f ->> 'qr_ordering')::boolean then raise exception 'feature_not_enabled' using detail = 'qr_ordering'; end if;
  v_counter := v_table.kind = 'counter';
  if v_counter and not (v_f ->> 'takeaway')::boolean then raise exception 'feature_not_enabled' using detail = 'takeaway'; end if;
  if p_pickup_at is not null and (not v_counter or p_pickup_at < now() - interval '1 minute'
      or (p_pickup_at at time zone 'Asia/Kuala_Lumpur')::date <> public.myt_today()) then
    raise exception 'invalid_input' using detail = 'pickup_at';
  end if;
  if coalesce(jsonb_typeof(p_lines), '') <> 'array' or jsonb_array_length(p_lines) not between 1 and 30 then
    raise exception 'invalid_input' using detail = 'lines';
  end if;
  if (select count(*) from public.orders o join public.tabs t on t.shop_id = o.shop_id and t.id = o.tab_id
      where t.table_id = v_table.id and o.created_at > now() - interval '5 minutes') >= (case when v_counter then 20 else 5 end) then
    raise exception 'rate_limited';
  end if;

  v_default_station := public.default_station(v_shop.id);
  v_multi := (v_f ->> 'multi_station')::boolean;

  -- Tab (step 8) and order (step 9). Any later failure rolls all of this back.
  if v_counter then
    insert into public.tabs (shop_id, table_id, kind, pickup_no, pickup_at)
    values (v_shop.id, v_table.id, 'counter', public.next_pickup_no(v_shop.id), p_pickup_at) returning * into v_tab;
  else
    select * into v_tab from public.tabs t where t.table_id = v_table.id and t.kind = 'table' and t.status = 'open' for update;
    -- A tab opened before today (MYT) was forgotten: close it unpaid and start a fresh one (first-order approval applies again).
    if found and (v_tab.opened_at at time zone 'Asia/Kuala_Lumpur')::date < public.myt_today() then
      update public.tabs set status = 'closed', closed_at = now(), updated_at = now() where id = v_tab.id;
      v_tab := null;
    end if;
    if v_tab.id is null then
      insert into public.tabs (shop_id, table_id, kind) values (v_shop.id, v_table.id, 'table') returning * into v_tab;
    end if;
  end if;
  v_mode := case when (v_f ->> 'approvals')::boolean then v_shop.approval_mode else 'none' end;
  v_needs_approval := v_mode = 'every_order' or (v_mode = 'first_order' and not exists (
    select 1 from public.orders o where o.tab_id = v_tab.id and o.status = 'approved'));
  insert into public.orders (shop_id, tab_id, status, approved_at)
  values (v_shop.id, v_tab.id, case when v_needs_approval then 'pending_approval' else 'approved' end::public.order_status,
          case when v_needs_approval then null else now() end)
  returning id into v_order_id;

  for v_line in select e.value from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'invalid_input' using detail = 'lines'; end if;

    -- parse
    v_item_id := public.try_uuid(v_line ->> 'itemId');
    if jsonb_typeof(v_line -> 'itemId') <> 'string' or v_item_id is null then
      raise exception 'invalid_input' using detail = 'item_id';
    end if;
    if coalesce(jsonb_typeof(v_line -> 'qty'), '') <> 'number' or (v_line ->> 'qty') !~ '^[0-9]{1,3}$' then
      raise exception 'invalid_input' using detail = 'qty';
    end if;
    v_qty := (v_line ->> 'qty')::int;
    if v_qty not between 1 and 99 then raise exception 'invalid_input' using detail = 'qty'; end if;
    if coalesce(jsonb_typeof(v_line -> 'note'), 'null') not in ('null', 'string') then
      raise exception 'invalid_input' using detail = 'note';
    end if;
    v_note := nullif(btrim(v_line ->> 'note', E' \t\r\n'), '');
    if char_length(v_note) > 140 then raise exception 'invalid_input' using detail = 'note'; end if;
    if coalesce(jsonb_typeof(v_line -> 'optionIds'), 'null') not in ('null', 'array') then
      raise exception 'invalid_input' using detail = 'option_ids';
    end if;
    select count(*), count(public.try_uuid(x.v)), coalesce(array_agg(public.try_uuid(x.v)) filter (where public.try_uuid(x.v) is not null), '{}')
      into v_n_all, v_n_ok, v_opts
    from jsonb_array_elements_text(coalesce(v_line -> 'optionIds', '[]'::jsonb)) x (v);
    if v_n_all <> v_n_ok or v_n_ok <> (select count(distinct u) from unnest(v_opts) u) then
      raise exception 'invalid_input' using detail = 'option_ids';
    end if;
    if coalesce(jsonb_typeof(v_line -> 'suggestedFromItemId'), 'null') not in ('null', 'string') then
      raise exception 'invalid_input' using detail = 'suggested_from_item_id';
    end if;
    v_from := public.try_uuid(v_line ->> 'suggestedFromItemId');
    if v_line ->> 'suggestedFromItemId' is not null and (v_from is null or not exists (
        select 1 from public.items x where x.shop_id = v_shop.id and x.id = v_from)) then
      raise exception 'invalid_input' using detail = 'suggested_from_item_id';
    end if;

    -- item rules
    select * into v_item from public.items i where i.shop_id = v_shop.id and i.id = v_item_id and i.active;
    if not found then raise exception 'item_unavailable' using detail = v_item_id::text; end if;
    if v_item.sold_out then raise exception 'sold_out' using detail = v_item.id::text; end if;
    if v_item.is_combo then
      if not (v_f ->> 'combos')::boolean then raise exception 'feature_not_enabled' using detail = 'combos'; end if;
      if cardinality(v_opts) > 0 then raise exception 'invalid_input' using detail = 'option_ids'; end if;
      if not exists (select 1 from public.combo_components cc join public.items ci on ci.shop_id = cc.shop_id and ci.id = cc.item_id
                     where cc.shop_id = v_shop.id and cc.combo_item_id = v_item.id) then
        raise exception 'item_unavailable' using detail = v_item.id::text;
      end if;
    end if;
    if (v_f ->> 'timed_menus')::boolean and exists (
        select 1 from public.categories c where c.shop_id = v_shop.id and c.id = v_item.category_id and c.available_from is not null
          and not public.in_window(c.available_from, c.available_to, c.available_days, now())) then
      raise exception 'item_unavailable' using detail = v_item.id::text;
    end if;

    -- options: membership, then every group of the item within [min, max]
    if cardinality(v_opts) > 0 and not (v_f ->> 'modifiers')::boolean then
      raise exception 'feature_not_enabled' using detail = 'modifiers';
    end if;
    if (select count(*) from public.modifier_options o join public.modifier_groups g on g.shop_id = o.shop_id and g.id = o.group_id
        where o.shop_id = v_shop.id and o.id = any (v_opts) and g.item_id = v_item.id) <> cardinality(v_opts)
       or exists (select 1 from public.modifier_groups g where g.shop_id = v_shop.id and g.item_id = v_item.id
         and (select count(*) from public.modifier_options o where o.group_id = g.id and o.id = any (v_opts))
             not between g.min_select and g.max_select) then
      raise exception 'invalid_input' using detail = 'option_ids';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('groupId', g.id, 'groupName', g.name, 'optionId', o.id, 'name', o.name,
             'priceDeltaSen', o.price_delta_sen) order by g.sort, g.name, o.sort, o.name), '[]'::jsonb),
           coalesce(sum(o.price_delta_sen), 0)::int
      into v_opts_json, v_opts_price
    from public.modifier_options o join public.modifier_groups g on g.shop_id = o.shop_id and g.id = o.group_id
    where o.shop_id = v_shop.id and o.id = any (v_opts);

    -- price on the server only (step 6)
    v_list := v_item.price_sen;
    v_unit := v_list;
    v_promo := null;
    if (v_f ->> 'promos')::boolean then
      select b.promo_id, b.price_sen into v_promo, v_unit from public.best_promo(v_item.id, v_list, now()) b;
      if v_promo is null then v_unit := v_list; end if;
    end if;

    -- station (step 7)
    v_station := case when v_item.is_combo or not v_multi then v_default_station
      else coalesce((select s.id from public.stations s where s.shop_id = v_shop.id and s.id = v_item.station_id and s.active),
                    v_default_station) end;

    v_line_no := v_line_no + 1;
    insert into public.order_items (shop_id, order_id, line_no, kind, item_id, name_snapshot, list_price_sen, unit_price_sen,
        promo_id, qty, options, options_price_sen, note, station_id, status, suggested_from_item_id)
    values (v_shop.id, v_order_id, v_line_no, case when v_item.is_combo then 'combo' else 'item' end::public.line_kind,
        v_item.id, v_item.name, v_list, v_unit, v_promo, v_qty, v_opts_json, v_opts_price, v_note, v_station,
        case when v_needs_approval then 'pending' else 'new' end::public.item_status, v_from)
    returning * into v_parent;
    v_priced := v_priced || jsonb_build_object('lineId', v_parent.id, 'itemId', v_parent.item_id, 'kind', v_parent.kind,
        'name', v_parent.name_snapshot, 'qty', v_parent.qty, 'listPriceSen', v_parent.list_price_sen,
        'unitPriceSen', v_parent.unit_price_sen, 'optionsPriceSen', v_parent.options_price_sen,
        'lineTotalSen', v_parent.line_total_sen, 'promoId', v_parent.promo_id);
    v_total := v_total + v_parent.line_total_sen;

    if v_item.is_combo then
      for v_comp in select ci.id, ci.name, ci.station_id, cc.qty from public.combo_components cc
          join public.items ci on ci.shop_id = cc.shop_id and ci.id = cc.item_id
          where cc.shop_id = v_shop.id and cc.combo_item_id = v_item.id order by cc.sort, ci.name loop
        v_line_no := v_line_no + 1;
        insert into public.order_items (shop_id, order_id, line_no, kind, parent_line_id, item_id, name_snapshot, list_price_sen,
            unit_price_sen, qty, note, station_id, status)
        values (v_shop.id, v_order_id, v_line_no, 'component', v_parent.id, v_comp.id, v_comp.name, 0, 0, v_qty * v_comp.qty, v_note,
            case when v_multi then coalesce((select s.id from public.stations s where s.shop_id = v_shop.id
                                              and s.id = v_comp.station_id and s.active), v_default_station)
                 else v_default_station end,
            case when v_needs_approval then 'pending' else 'new' end::public.item_status)
        returning * into v_row;
        v_priced := v_priced || jsonb_build_object('lineId', v_row.id, 'itemId', v_row.item_id, 'kind', v_row.kind,
            'name', v_row.name_snapshot, 'qty', v_row.qty, 'listPriceSen', 0, 'unitPriceSen', 0, 'optionsPriceSen', 0,
            'lineTotalSen', 0, 'promoId', null);
      end loop;
    end if;
  end loop;

  update public.tabs set updated_at = now() where id = v_tab.id;
  return jsonb_build_object('orderId', v_order_id, 'tabId', v_tab.id,
    'status', case when v_needs_approval then 'pending_approval' else 'approved' end,
    'pickupNo', v_tab.pickup_no, 'totalSen', v_total, 'lines', v_priced);
end $$;

create or replace function public.get_tab(p_table_token text, p_tab_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
declare
  v_table public.tables;
  v_tab public.tabs;
  v_total int := 0;
  v_pending int := 0;
  v_paid int := 0;
  v_orders jsonb := '[]'::jsonb;
begin
  select * into v_table from public.tables t where t.token = p_table_token and t.active;
  if not found then raise exception 'not_found'; end if;
  if v_table.kind = 'counter' then
    if p_tab_id is null then raise exception 'invalid_input' using detail = 'tab_id'; end if;
    select * into v_tab from public.tabs t
      where t.id = p_tab_id and t.table_id = v_table.id and t.opened_at > now() - interval '24 hours';
    if not found then raise exception 'not_found'; end if;
  else
    select * into v_tab from public.tabs t where t.table_id = v_table.id and t.status = 'open'
      and (t.opened_at at time zone 'Asia/Kuala_Lumpur')::date >= public.myt_today();
  end if;

  if v_tab.id is not null then
    select m.total_sen, m.pending_sen, m.paid_sen into v_total, v_pending, v_paid from public.tab_money(v_tab.id) m;
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'createdAt', o.created_at,
        'rejectedReason', o.rejected_reason,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', oi.id, 'itemId', oi.item_id, 'kind', oi.kind,
              'parentLineId', oi.parent_line_id, 'name', oi.name_snapshot, 'qty', oi.qty, 'options', oi.options, 'note', oi.note,
              'listPriceSen', oi.list_price_sen, 'unitPriceSen', oi.unit_price_sen, 'optionsPriceSen', oi.options_price_sen,
              'lineTotalSen', oi.line_total_sen, 'status', oi.status) order by oi.line_no), '[]'::jsonb)
            from public.order_items oi where oi.order_id = o.id)
      ) order by o.created_at, o.id), '[]'::jsonb)
    into v_orders from public.orders o where o.tab_id = v_tab.id;
  end if;

  return jsonb_build_object(
    'table', jsonb_build_object('label', v_table.label, 'kind', v_table.kind),
    'tab', case when v_tab.id is null then null else jsonb_build_object('id', v_tab.id, 'status', v_tab.status,
        'openedAt', v_tab.opened_at, 'closedAt', v_tab.closed_at, 'pickupNo', v_tab.pickup_no, 'pickupAt', v_tab.pickup_at,
        'totalSen', v_total, 'pendingSen', v_pending, 'paidSen', v_paid) end,
    'orders', v_orders,
    'openRequests', (select coalesce(jsonb_agg(jsonb_build_object('reason', r.reason, 'status', r.status, 'createdAt', r.created_at)
        order by r.created_at), '[]'::jsonb) from public.service_requests r where r.table_id = v_table.id and r.status <> 'done'),
    'serverNow', now());
end $$;

create or replace function public.call_server(p_table_token text, p_reason public.service_reason, p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_table public.tables;
  v_shop public.shops;
  v_note text := nullif(btrim(p_note, E' \t\r\n'), '');
  v_row public.service_requests;
begin
  select * into v_table from public.tables t where t.token = p_table_token and t.active;
  if not found then raise exception 'not_found'; end if;
  select * into v_shop from public.shops s where s.id = v_table.shop_id;
  if not v_shop.active then raise exception 'shop_inactive'; end if;
  perform public.assert_feature(v_shop.id, 'call_server');
  if p_reason is null or char_length(v_note) > 140 then
    raise exception 'invalid_input' using detail = case when p_reason is null then 'reason' else 'note' end;
  end if;
  -- Throttle: a tap within 10 seconds of the last one on the same open call changes nothing.
  select * into v_row from public.service_requests r
    where r.table_id = v_table.id and r.reason = p_reason and r.status = 'open' and r.updated_at > now() - interval '10 seconds';
  if found then return jsonb_build_object('requestId', v_row.id, 'tapCount', v_row.tap_count); end if;
  -- A repeat tap merges into the open call and re-opens an acknowledged one (D26).
  insert into public.service_requests (shop_id, table_id, tab_id, reason, note)
  values (v_shop.id, v_table.id,
    (select t.id from public.tabs t where t.table_id = v_table.id and t.status = 'open'
      and (t.opened_at at time zone 'Asia/Kuala_Lumpur')::date >= public.myt_today() limit 1), p_reason, v_note)
  on conflict (table_id, reason) where status <> 'done' do update
    set tap_count = public.service_requests.tap_count + 1,
        note = coalesce(excluded.note, public.service_requests.note),
        status = 'open', updated_at = now()
  returning * into v_row;
  return jsonb_build_object('requestId', v_row.id, 'tapCount', v_row.tap_count);
end $$;

create or replace function public.get_pickup_board(p_board_token text) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
declare
  v_shop public.shops;
begin
  select * into v_shop from public.shops s where s.pickup_board_token = p_board_token;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_feature(v_shop.id, 'takeaway');
  return (
    select jsonb_build_object('shopName', v_shop.name,
      'preparing', coalesce(jsonb_agg(b.pickup_no order by b.pickup_no) filter (where b.prep), '[]'::jsonb),
      'ready', coalesce(jsonb_agg(b.pickup_no order by b.pickup_no) filter (where not b.prep and b.rdy), '[]'::jsonb),
      'serverNow', now())
    from (
      select t.pickup_no,
        bool_or(oi.status in ('new', 'preparing', 'cooking')) prep,
        bool_or(oi.status = 'ready') rdy
      from public.tabs t
      join public.orders o on o.shop_id = t.shop_id and o.tab_id = t.id and o.status = 'approved'
      join public.order_items oi on oi.shop_id = o.shop_id and oi.order_id = o.id
        and oi.kind <> 'combo' and oi.status <> 'cancelled'
      where t.shop_id = v_shop.id and t.kind = 'counter' and t.pickup_no is not null
        and (t.opened_at at time zone 'Asia/Kuala_Lumpur')::date = public.myt_today()
      group by t.id, t.pickup_no
    ) b);
end $$;
