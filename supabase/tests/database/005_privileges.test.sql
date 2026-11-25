begin;
select plan(23);

-- anon: nothing yet except (later, M2-C) the five customer RPCs.
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
             and p.proname not in ('get_menu', 'place_order', 'get_tab', 'call_server', 'get_pickup_board')),
  0::bigint, 'anon can execute nothing outside the five-RPC allowlist');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S', 'p')
             and has_any_column_privilege('anon', c.oid, 'select,insert,update,references')), 0::bigint,
  'anon has no table, view or sequence privilege in public');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'), 0::bigint, 'anon has no grants (information_schema)');

-- authenticated: no privileges at all on the secret tables
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname in ('staff_pins', 'staff_sessions', 'pin_attempts', 'pickup_counters', 'platform_settings')
             and has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references')), 0::bigint,
  'authenticated has no privilege on staff_pins, staff_sessions, pin_attempts, pickup_counters, platform_settings');
-- ... and no write privilege on tables that change only through RPCs
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname in ('tabs', 'orders', 'order_items', 'service_requests', 'tab_payments',
             'staff', 'item_pairings', 'auto_pairings', 'combo_components', 'promo_items', 'board_columns',
             'shop_owners', 'shop_feature_overrides', 'platform_admins', 'entitlement_keys', 'plans', 'plan_features')
             and has_any_column_privilege('authenticated', c.oid, 'insert,update')), 0::bigint,
  'authenticated cannot insert or update RPC-only and reference tables');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'delete')
             and c.relname not in ('categories', 'modifier_groups', 'modifier_options', 'promos')), 0::bigint,
  'authenticated may delete only from categories, modifier groups/options and promos');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'truncate,trigger,references')), 0::bigint,
  'authenticated has no truncate, trigger or references privilege');
select is((select count(*) from pg_policies where schemaname = 'public'
           and tablename in ('staff_pins', 'staff_sessions', 'pin_attempts', 'pickup_counters', 'platform_settings')), 0::bigint,
  'secret tables have no policies (deny by default)');
select is((select count(*) from pg_policies where schemaname = 'public' and not ('authenticated' = any (roles))), 0::bigint,
  'every policy is for authenticated only');

-- Functions
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef and not exists (
             select 1 from unnest(p.proconfig) c where c = 'search_path=""')), 0::bigint,
  'every security definer function in public has search_path = ""');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and not p.prosecdef), 0::bigint, 'every function in public is security definer');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
             and (p.proname in ('entitlements_of', 'limit_of', 'within_limit', 'default_station', 'current_staff_id',
                  'assert_member', 'assert_owner', 'assert_admin', 'assert_feature', 'next_pickup_no', 'tab_money',
                  'assert_report_window', 'refresh_auto_pairings', 'myt_today', 'in_window', 'round_cash', 'best_promo',
                  'staff_session_json', 'new_staff_code', 'staff_lines_of', 'board_lines', 'tab_summary', 'pin_taken', 'sales_lines',
                  'table_row_json', 'promo_row_json', 'menu_editor_of')
                  or p.proname like 'trg\_%')), 0::bigint,
  'authenticated cannot execute internal helpers or trigger functions');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')),
  array['acknowledge_request', 'add_staff', 'admin_clear_override', 'admin_create_shop', 'admin_get_platform_settings',
        'admin_list_shops', 'admin_set_override', 'admin_set_plan', 'admin_set_platform_settings',
        'admin_set_shop_active', 'advance_item', 'approve_order', 'call_server', 'claim_staff_session',
        'complete_request', 'current_shop_ids', 'end_staff_session', 'export_orders', 'export_shop_meta', 'get_board',
        'get_daily_summary', 'get_entitlements', 'get_menu', 'get_menu_editor',
        'get_pending_orders', 'get_pickup_board', 'get_ready_lines', 'get_sales_report', 'get_service_requests',
        'get_shop_plan', 'get_sold_out_items', 'get_staff_code', 'get_stations', 'get_tab', 'get_tab_detail', 'get_tables_overview',
        'get_upsell_report', 'has_feature', 'is_member', 'is_owner',
        'is_platform_admin', 'my_shops', 'my_staff_session', 'new_token', 'place_order', 'record_payment',
        'regenerate_pickup_board_token', 'regenerate_staff_code', 'regenerate_table_token', 'reject_order', 'save_promo', 'set_board_columns',
        'set_combo_components', 'set_item_pairings', 'set_item_sold_out', 'set_staff_pin', 'try_uuid', 'update_staff'],
  'authenticated executes exactly the granted helpers (grows with later migrations)');

-- Behaviour as a signed-in owner
insert into public.shop_feature_overrides (shop_id, feature_key, enabled, note)
  values (md5('shop:a')::uuid, 'takeaway', true, 'test');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', md5('user:owner-a')::uuid, 'role', 'authenticated')::text, true);
select throws_ok($$select * from public.staff_pins$$, '42501', null, 'authenticated cannot read staff_pins');
select throws_ok($$select * from public.staff_sessions$$, '42501', null, 'authenticated cannot read staff_sessions');
select throws_ok($$select * from public.pin_attempts$$, '42501', null, 'authenticated cannot read pin_attempts');
select throws_ok($$select * from public.pickup_counters$$, '42501', null, 'authenticated cannot read pickup_counters');
select throws_ok($$select * from public.platform_settings$$, '42501', null, 'authenticated cannot read platform_settings');
select lives_ok($$update public.shops set name = 'Kopitiam Teras Baru' where id = md5('shop:a')::uuid$$, 'owner A can update shops.name');
select throws_ok($$update public.shops set plan_id = 'pro' where id = md5('shop:a')::uuid$$, '42501', null, 'owner A cannot update shops.plan_id');
select throws_ok($$update public.shops set slug = 'x-shop' where id = md5('shop:a')::uuid$$, '42501', null, 'owner A cannot update shops.slug');
select throws_ok($$update public.tables set token = 'tok-aaaaaaaaaaaaaaaaaaaaaa' where id = md5('table:a:01')::uuid$$, '42501', null, 'owner A cannot update tables.token');
select lives_ok($$update public.tables set label = 'Meja 1' where id = md5('table:a:01')::uuid$$, 'owner A can rename a table');

select * from finish();
rollback;
