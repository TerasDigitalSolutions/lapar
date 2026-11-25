-- Lapar staff RPCs (M2-D): PIN sessions, approvals, calls, board, payments, sold out.
-- See docs/DATA-MODEL.md sections 6.2, 6.3, 7.1. First line of each RPC checks the caller.
-- Internal helpers (staff_session_json, staff_lines_of, board_lines, tab_summary) have no grants.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
-- StaffSession for a live session of p_uid (plus pickupBoardToken: the staff pickup-board overlay needs it;
-- shopName is for printed bills). The token is null unless the shop has `takeaway`.
create function public.staff_session_json(p_uid uuid) returns jsonb
language sql security definer set search_path = '' stable
as $$
  select jsonb_build_object('shopId', s.id, 'shopName', s.name, 'shopSlug', s.slug,
    'pickupBoardToken', case when public.has_feature(s.id, 'takeaway') then s.pickup_board_token end,
    'staffId', st.id, 'staffName', st.name, 'expiresAt', ss.expires_at)
  from public.staff_sessions ss
  join public.staff st on st.shop_id = ss.shop_id and st.id = ss.staff_id and st.active
  join public.shops s on s.id = ss.shop_id
  where ss.auth_uid = p_uid and ss.expires_at > now()
$$;

-- StaffLineDTO[] of one order, in line_no order.
create function public.staff_lines_of(p_order uuid) returns jsonb
language sql security definer set search_path = '' stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', oi.id, 'itemId', oi.item_id, 'kind', oi.kind,
    'parentLineId', oi.parent_line_id, 'name', oi.name_snapshot, 'qty', oi.qty, 'options', oi.options, 'note', oi.note,
    'listPriceSen', oi.list_price_sen, 'unitPriceSen', oi.unit_price_sen, 'optionsPriceSen', oi.options_price_sen,
    'lineTotalSen', oi.line_total_sen, 'status', oi.status, 'stationId', oi.station_id, 'columnId', oi.column_id,
    'paidPaymentId', oi.paid_payment_id, 'statusChangedAt', oi.status_changed_at) order by oi.line_no), '[]'::jsonb)
  from public.order_items oi where oi.order_id = p_order
$$;

-- BoardLineDTO[]: p_ready_only = the "to serve" strip (all stations, ready, oldest change first);
-- else the station's new..ready lines, oldest approval first. position/positionOf count the order's
-- non-cancelled item/component lines.
create function public.board_lines(p_shop uuid, p_station uuid, p_ready_only boolean) returns jsonb
language sql security definer set search_path = '' stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'orderId', x.order_id, 'tabId', o.tab_id,
      'tableLabel', tb.label, 'tableKind', tb.kind, 'pickupNo', t.pickup_no, 'itemId', x.item_id,
      'name', x.name_snapshot, 'qty', x.qty, 'options', x.options, 'note', x.note, 'kind', x.kind,
      'parentName', par.name_snapshot, 'status', x.status, 'columnId', x.column_id, 'stationId', x.station_id,
      'position', x.pos, 'positionOf', x.pos_of, 'approvedAt', coalesce(o.approved_at, o.created_at),
      'statusChangedAt', x.status_changed_at)
    order by case when p_ready_only then x.status_changed_at else o.approved_at end, o.approved_at, x.order_id, x.line_no), '[]'::jsonb)
  from (
    select oi.*,
      count(*) filter (where oi.kind <> 'combo' and oi.status <> 'cancelled') over (partition by oi.order_id order by oi.line_no) pos,
      count(*) filter (where oi.kind <> 'combo' and oi.status <> 'cancelled') over (partition by oi.order_id) pos_of
    from public.order_items oi
    where oi.shop_id = p_shop and oi.order_id in (
      select b.order_id from public.order_items b
      where b.shop_id = p_shop and b.status in ('new', 'preparing', 'cooking', 'ready'))
  ) x
  join public.orders o on o.id = x.order_id and o.status = 'approved'
  join public.tabs t on t.id = o.tab_id
  join public.tables tb on tb.id = t.table_id
  left join public.order_items par on par.id = x.parent_line_id
  where x.kind <> 'combo'
    and case when p_ready_only then x.status = 'ready'
             else x.station_id = p_station and x.status in ('new', 'preparing', 'cooking', 'ready') end
$$;

-- TabSummaryDTO
create function public.tab_summary(p_tab uuid) returns jsonb
language sql security definer set search_path = '' stable
as $$
  select jsonb_build_object('id', t.id, 'openedAt', t.opened_at, 'pickupNo', t.pickup_no, 'pickupAt', t.pickup_at,
    'totalSen', m.total_sen, 'paidSen', m.paid_sen, 'remainingSen', greatest(0, m.total_sen - m.paid_sen),
    'pendingOrders', (select count(*) from public.orders o where o.tab_id = t.id and o.status = 'pending_approval'),
    'readyLines', (select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id
                   where o.tab_id = t.id and o.status = 'approved' and oi.kind <> 'combo' and oi.status = 'ready'))
  from public.tabs t, public.tab_money(t.id) m
  where t.id = p_tab
$$;

-- ---------------------------------------------------------------------------
-- 6.2 Sessions
-- ---------------------------------------------------------------------------
create function public.claim_staff_session(p_shop_slug text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' volatile
as $$
declare
  v_shop public.shops;
  v_att public.pin_attempts;
  v_staff uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_shop from public.shops s where s.slug = p_shop_slug;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_feature(v_shop.id, 'staff_pins');

  insert into public.pin_attempts (shop_id) values (v_shop.id) on conflict do nothing;
  select * into v_att from public.pin_attempts a where a.shop_id = v_shop.id for update;
  if v_att.locked_until is not null then
    if v_att.locked_until > now() then
      return jsonb_build_object('ok', false, 'error', 'pin_locked', 'lockedUntil', v_att.locked_until);
    end if;
    update public.pin_attempts set failures = 0, locked_until = null, updated_at = now() where shop_id = v_shop.id;
    v_att.failures := 0;
  end if;

  if p_pin ~ '^[0-9]{4,6}$' then
    select st.id into v_staff from public.staff st join public.staff_pins p on p.shop_id = st.shop_id and p.staff_id = st.id
    where st.shop_id = v_shop.id and st.active and p.pin_hash = extensions.crypt(p_pin, p.pin_hash) limit 1;
  end if;

  if v_staff is null then
    -- Return, never raise: raising would roll the counter back.
    if v_att.failures + 1 >= 5 then
      update public.pin_attempts set failures = 0, locked_until = now() + interval '10 minutes', updated_at = now()
        where shop_id = v_shop.id returning locked_until into v_att.locked_until;
      return jsonb_build_object('ok', false, 'error', 'pin_locked', 'lockedUntil', v_att.locked_until);
    end if;
    update public.pin_attempts set failures = v_att.failures + 1, updated_at = now() where shop_id = v_shop.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;

  update public.pin_attempts set failures = 0, updated_at = now() where shop_id = v_shop.id;
  insert into public.staff_sessions (auth_uid, shop_id, staff_id, created_at, expires_at)
  values (auth.uid(), v_shop.id, v_staff, now(), now() + interval '16 hours')
  on conflict (auth_uid) do update
    set shop_id = excluded.shop_id, staff_id = excluded.staff_id, created_at = excluded.created_at, expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true, 'session', public.staff_session_json(auth.uid()));
end $$;

create function public.my_staff_session() returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  return public.staff_session_json(auth.uid());
end $$;

create function public.end_staff_session() returns void
language plpgsql security definer set search_path = '' volatile
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  delete from public.staff_sessions where auth_uid = auth.uid();
end $$;

create function public.my_shops() returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'active', s.active,
      'planId', s.plan_id) order by s.created_at, s.name)
    from public.shop_owners o join public.shops s on s.id = o.shop_id where o.user_id = auth.uid()), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 6.3 Approvals
-- ---------------------------------------------------------------------------
create function public.get_pending_orders(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_member(p_shop_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('orderId', o.id, 'tabId', t.id, 'tableId', tb.id, 'tableLabel', tb.label,
      'tableKind', tb.kind, 'pickupNo', t.pickup_no, 'pickupAt', t.pickup_at, 'createdAt', o.created_at,
      'totalSen', (select coalesce(sum(oi.line_total_sen), 0) from public.order_items oi
                   where oi.order_id = o.id and oi.kind <> 'component' and oi.status <> 'cancelled'),
      'lines', public.staff_lines_of(o.id)) order by o.created_at, o.id)
    from public.orders o
    join public.tabs t on t.id = o.tab_id
    join public.tables tb on tb.id = t.table_id
    where o.shop_id = p_shop_id and o.status = 'pending_approval'), '[]'::jsonb);
end $$;

create function public.approve_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare
  v_order public.orders;
  v_tab public.tabs;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_member(v_order.shop_id);
  if v_order.status <> 'pending_approval' then raise exception 'invalid_transition'; end if;
  select * into v_tab from public.tabs t where t.id = v_order.tab_id;
  if v_tab.status <> 'open' then raise exception 'tab_closed'; end if;
  update public.orders set status = 'approved', approved_at = now(),
    approved_by_staff_id = public.current_staff_id(v_order.shop_id) where id = v_order.id;
  update public.order_items set status = 'new', status_changed_at = now()
    where order_id = v_order.id and status = 'pending';
  update public.tabs set updated_at = now() where id = v_tab.id;
end $$;

create function public.reject_order(p_order_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare
  v_order public.orders;
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_member(v_order.shop_id);
  if v_reason is null or char_length(v_reason) > 140 then raise exception 'invalid_input' using detail = 'reason'; end if;
  if v_order.status <> 'pending_approval' then raise exception 'invalid_transition'; end if;
  update public.orders set status = 'rejected', rejected_reason = v_reason where id = v_order.id;
  update public.order_items set status = 'cancelled', status_changed_at = now() where order_id = v_order.id;
  update public.tabs set updated_at = now() where id = v_order.tab_id;
end $$;

-- ---------------------------------------------------------------------------
-- 6.3 Server calls
-- ---------------------------------------------------------------------------
create function public.get_service_requests(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_member(p_shop_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'tableId', r.table_id, 'tableLabel', tb.label, 'tabId', r.tab_id,
      'reason', r.reason, 'note', r.note, 'status', r.status, 'tapCount', r.tap_count, 'createdAt', r.created_at,
      'acknowledgedAt', r.acknowledged_at, 'updatedAt', r.updated_at) order by r.created_at, r.id)
    from public.service_requests r join public.tables tb on tb.shop_id = r.shop_id and tb.id = r.table_id
    where r.shop_id = p_shop_id and r.status in ('open', 'acknowledged')), '[]'::jsonb);
end $$;

create function public.acknowledge_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare v_req public.service_requests;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_req from public.service_requests r where r.id = p_request_id for update;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_member(v_req.shop_id);
  if v_req.status = 'done' then raise exception 'invalid_transition'; end if;
  if v_req.status = 'open' then
    update public.service_requests set status = 'acknowledged', acknowledged_at = now() where id = v_req.id;
  end if;
end $$;

create function public.complete_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare v_req public.service_requests;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_req from public.service_requests r where r.id = p_request_id for update;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_member(v_req.shop_id);
  if v_req.status <> 'done' then
    update public.service_requests set status = 'done', done_at = now() where id = v_req.id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6.3 Board
-- ---------------------------------------------------------------------------
create function public.get_stations(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_member(p_shop_id);
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'shopId', s.shop_id, 'name', s.name, 'sort', s.sort,
      'active', s.active) order by s.sort, s.created_at)
    from public.stations s where s.shop_id = p_shop_id and s.active), '[]'::jsonb);
end $$;

create function public.get_board(p_shop_id uuid, p_station_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
declare
  v_station public.stations;
  v_columns jsonb := '[]'::jsonb;
begin
  perform public.assert_member(p_shop_id);
  select * into v_station from public.stations s
    where s.shop_id = p_shop_id and s.id = coalesce(p_station_id, public.default_station(p_shop_id));
  if not found then raise exception 'not_found'; end if;
  if public.has_feature(p_shop_id, 'custom_columns') then
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'coreStatus', c.core_status, 'sort', c.sort)
      order by c.sort), '[]'::jsonb) into v_columns
    from public.board_columns c where c.shop_id = p_shop_id and c.station_id = v_station.id;
  end if;
  if v_columns = '[]'::jsonb then
    v_columns := jsonb_build_array(
      jsonb_build_object('id', null, 'name', null, 'coreStatus', 'new', 'sort', 0),
      jsonb_build_object('id', null, 'name', null, 'coreStatus', 'preparing', 'sort', 1),
      jsonb_build_object('id', null, 'name', null, 'coreStatus', 'cooking', 'sort', 2),
      jsonb_build_object('id', null, 'name', null, 'coreStatus', 'ready', 'sort', 3));
  end if;
  return jsonb_build_object('stationId', v_station.id, 'stationName', v_station.name, 'columns', v_columns,
    'lines', public.board_lines(p_shop_id, v_station.id, false), 'serverNow', now());
end $$;

create function public.advance_item(p_item_id uuid, p_to public.item_status, p_column_id uuid default null) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare
  v_line public.order_items;
  v_order public.orders;
  v_ok boolean;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_line from public.order_items oi where oi.id = p_item_id for update;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_member(v_line.shop_id);
  if p_to is null then raise exception 'invalid_input' using detail = 'to'; end if;
  select * into v_order from public.orders o where o.id = v_line.order_id;
  if v_order.status <> 'approved' or v_line.kind = 'combo' then raise exception 'invalid_transition'; end if;
  v_ok := case when v_line.status = p_to then p_column_id is not null
    else (v_line.status, p_to) in (('new', 'preparing'), ('preparing', 'cooking'), ('cooking', 'ready'), ('ready', 'served'),
      ('preparing', 'new'), ('cooking', 'preparing'), ('ready', 'cooking'),
      ('new', 'cancelled'), ('preparing', 'cancelled'), ('cooking', 'cancelled'), ('ready', 'cancelled')) end;
  if not v_ok then raise exception 'invalid_transition'; end if;
  if p_column_id is not null then
    perform public.assert_feature(v_line.shop_id, 'custom_columns');
    if not exists (select 1 from public.board_columns c where c.shop_id = v_line.shop_id and c.id = p_column_id
                   and c.station_id = v_line.station_id and c.core_status = p_to) then
      raise exception 'invalid_input' using detail = 'column_id';
    end if;
  end if;
  update public.order_items set status = p_to, column_id = p_column_id, status_changed_at = now(),
    ready_at = case when p_to = 'ready' then now() else ready_at end,
    served_at = case when p_to = 'served' then now() else served_at end
  where id = v_line.id;
end $$;

create function public.get_ready_lines(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_member(p_shop_id);
  return public.board_lines(p_shop_id, null, true);
end $$;

-- ---------------------------------------------------------------------------
-- 6.3 Tables and tabs
-- ---------------------------------------------------------------------------
create function public.get_tables_overview(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_member(p_shop_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('tableId', t.id, 'label', t.label, 'kind', t.kind,
      'openRequests', (select count(*) from public.service_requests r where r.table_id = t.id and r.status <> 'done'),
      'openTabs', (select coalesce(jsonb_agg(public.tab_summary(tb.id) order by tb.opened_at, tb.id), '[]'::jsonb)
                   from public.tabs tb where tb.table_id = t.id and tb.status = 'open'
                     and (t.kind = 'table' or (tb.opened_at at time zone 'Asia/Kuala_Lumpur')::date = public.myt_today()))
    ) order by t.kind, t.sort, t.label)
    from public.tables t where t.shop_id = p_shop_id and t.active), '[]'::jsonb);
end $$;

create function public.get_tab_detail(p_tab_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
declare
  v_tab public.tabs;
  v_table public.tables;
  v_m record;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_tab from public.tabs t where t.id = p_tab_id;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_member(v_tab.shop_id);
  select * into v_table from public.tables tb where tb.id = v_tab.table_id;
  select * into v_m from public.tab_money(v_tab.id);
  return jsonb_build_object('id', v_tab.id, 'tableId', v_table.id, 'tableLabel', v_table.label, 'tableKind', v_table.kind,
    'status', v_tab.status, 'openedAt', v_tab.opened_at, 'closedAt', v_tab.closed_at,
    'pickupNo', v_tab.pickup_no, 'pickupAt', v_tab.pickup_at,
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'createdAt', o.created_at,
        'approvedAt', o.approved_at, 'rejectedReason', o.rejected_reason, 'lines', public.staff_lines_of(o.id))
        order by o.created_at, o.id), '[]'::jsonb) from public.orders o where o.tab_id = v_tab.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'method', p.method, 'amountSen', p.amount_sen,
        'roundingSen', p.rounding_sen, 'createdAt', p.created_at,
        'orderItemIds', (select coalesce(jsonb_agg(oi.id order by oi.created_at, oi.line_no), '[]'::jsonb)
                         from public.order_items oi where oi.paid_payment_id = p.id)) order by p.created_at, p.id), '[]'::jsonb)
        from public.tab_payments p where p.tab_id = v_tab.id),
    'totalSen', v_m.total_sen, 'paidSen', v_m.paid_sen, 'remainingSen', greatest(0, v_m.total_sen - v_m.paid_sen),
    'roundingSen', v_m.rounding_sen,
    'hasPendingOrders', exists (select 1 from public.orders o where o.tab_id = v_tab.id and o.status = 'pending_approval'),
    'serverNow', now());
end $$;

create function public.record_payment(
  p_tab_id uuid, p_method public.paid_method, p_amount_sen int default null, p_order_item_ids uuid[] default null
) returns jsonb
language plpgsql security definer set search_path = '' volatile
as $$
declare
  v_tab public.tabs;
  v_m record;
  v_remaining int;
  v_split boolean;
  v_ids uuid[];
  v_amount int;
  v_pay public.tab_payments;
  v_closed boolean;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_tab from public.tabs t where t.id = p_tab_id for update;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_member(v_tab.shop_id);
  if v_tab.status <> 'open' then raise exception 'tab_closed'; end if;
  perform public.assert_feature(v_tab.shop_id, 'manual_payments');
  if p_method is null then raise exception 'invalid_input' using detail = 'method'; end if;
  if exists (select 1 from public.orders o where o.tab_id = v_tab.id and o.status = 'pending_approval') then
    raise exception 'pending_orders';
  end if;
  select * into v_m from public.tab_money(v_tab.id);
  v_remaining := greatest(0, v_m.total_sen - v_m.paid_sen);
  v_split := coalesce(cardinality(p_order_item_ids), 0) > 0;

  if v_split then
    perform public.assert_feature(v_tab.shop_id, 'bill_split');
    if exists (select 1 from public.tab_payments p where p.tab_id = v_tab.id
               and not exists (select 1 from public.order_items oi where oi.paid_payment_id = p.id)) then
      raise exception 'invalid_input' using detail = 'mixed_split';
    end if;
    select array_agg(distinct x) into v_ids from unnest(p_order_item_ids) x;
    select sum(oi.line_total_sen) into v_amount
    from public.order_items oi join public.orders o on o.id = oi.order_id
    where oi.id = any (v_ids) and o.tab_id = v_tab.id and o.status = 'approved'
      and oi.kind <> 'component' and oi.status <> 'cancelled' and oi.paid_payment_id is null;
    if (select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id
        where oi.id = any (v_ids) and o.tab_id = v_tab.id and o.status = 'approved'
          and oi.kind <> 'component' and oi.status <> 'cancelled' and oi.paid_payment_id is null) <> cardinality(v_ids) then
      raise exception 'invalid_input' using detail = 'order_item_ids';
    end if;
  else
    v_amount := coalesce(p_amount_sen, v_remaining);
  end if;

  if v_remaining > 0 then
    if v_amount < 1 or v_amount > v_remaining then
      raise exception 'invalid_input' using detail = case when v_split then 'order_item_ids' else 'amount' end;
    end if;
    if v_amount < v_remaining and not v_split then perform public.assert_feature(v_tab.shop_id, 'bill_split'); end if;
    insert into public.tab_payments (shop_id, tab_id, method, amount_sen, rounding_sen, created_by_staff_id)
    values (v_tab.shop_id, v_tab.id, p_method, v_amount,
      case when p_method = 'cash' then public.round_cash(v_amount) - v_amount else 0 end,
      public.current_staff_id(v_tab.shop_id))
    returning * into v_pay;
    if v_split then
      update public.order_items set paid_payment_id = v_pay.id where id = any (v_ids);
    end if;
  end if;

  select * into v_m from public.tab_money(v_tab.id);
  v_closed := v_m.paid_sen >= v_m.total_sen;
  if v_closed then
    update public.tabs set status = 'closed', closed_at = now(), paid_total_sen = v_m.paid_sen,
      rounding_sen = v_m.rounding_sen, updated_at = now() where id = v_tab.id;
  else
    update public.tabs set updated_at = now() where id = v_tab.id;
  end if;
  return jsonb_build_object('paymentId', v_pay.id, 'amountSen', coalesce(v_pay.amount_sen, 0),
    'roundingSen', coalesce(v_pay.rounding_sen, 0), 'remainingSen', greatest(0, v_m.total_sen - v_m.paid_sen),
    'tabClosed', v_closed);
end $$;

-- ---------------------------------------------------------------------------
-- 6.3 Sold out
-- ---------------------------------------------------------------------------
create function public.get_sold_out_items(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_member(p_shop_id);
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'categoryId', i.category_id, 'categoryName', c.name,
      'name', i.name, 'soldOut', i.sold_out) order by c.sort, c.name, i.sort, i.name)
    from public.items i join public.categories c on c.shop_id = i.shop_id and c.id = i.category_id
    where i.shop_id = p_shop_id and i.active), '[]'::jsonb);
end $$;

create function public.set_item_sold_out(p_item_id uuid, p_sold_out boolean) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare v_shop uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select i.shop_id into v_shop from public.items i where i.id = p_item_id;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_member(v_shop);
  if p_sold_out is null then raise exception 'invalid_input' using detail = 'sold_out'; end if;
  update public.items set sold_out = p_sold_out where id = p_item_id;
end $$;

-- ---------------------------------------------------------------------------
-- Grants (section 7.1)
-- ---------------------------------------------------------------------------
grant execute on function
  public.claim_staff_session(text, text), public.my_staff_session(), public.end_staff_session(), public.my_shops(),
  public.get_pending_orders(uuid), public.approve_order(uuid), public.reject_order(uuid, text),
  public.get_service_requests(uuid), public.acknowledge_request(uuid), public.complete_request(uuid),
  public.get_stations(uuid), public.get_board(uuid, uuid), public.advance_item(uuid, public.item_status, uuid),
  public.get_ready_lines(uuid), public.get_tables_overview(uuid), public.get_tab_detail(uuid),
  public.record_payment(uuid, public.paid_method, int, uuid[]),
  public.get_sold_out_items(uuid), public.set_item_sold_out(uuid, boolean)
  to authenticated;
