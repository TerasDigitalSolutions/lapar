-- Per-shop color theme (D44). Owners pick one of four; it reaches every screen that shows the shop.
alter table public.shops add column theme text not null default 'kopitiam'
  check (theme in ('kopitiam', 'pandan', 'teh-tarik', 'malam'));
grant update (theme) on public.shops to authenticated;

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
      'active', v_shop.active, 'theme', v_shop.theme,
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
    select jsonb_build_object('shopName', v_shop.name, 'theme', v_shop.theme,
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

-- staff_session_json feeds claim_staff_session and my_staff_session.
create or replace function public.staff_session_json(p_uid uuid) returns jsonb
language sql security definer set search_path = '' stable
as $$
  select jsonb_build_object('shopId', s.id, 'shopName', s.name, 'shopSlug', s.slug, 'shopTheme', s.theme,
    'pickupBoardToken', case when public.has_feature(s.id, 'takeaway') then s.pickup_board_token end,
    'staffId', st.id, 'staffName', st.name, 'expiresAt', ss.expires_at)
  from public.staff_sessions ss
  join public.staff st on st.shop_id = ss.shop_id and st.id = ss.staff_id and st.active
  join public.shops s on s.id = ss.shop_id
  where ss.auth_uid = p_uid and ss.expires_at > now()
$$;

create or replace function public.my_shops() returns jsonb
language plpgsql security definer set search_path = '' stable
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'active', s.active,
      'planId', s.plan_id, 'theme', s.theme) order by s.created_at, s.name)
    from public.shop_owners o join public.shops s on s.id = o.shop_id where o.user_id = auth.uid()), '[]'::jsonb);
end $$;
