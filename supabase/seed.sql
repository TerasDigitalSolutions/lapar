-- Local and CI seed ONLY (supabase db push never runs it). Every password and PIN below is a throwaway
-- test value for local development. Ids: md5('<kind>:<shop>:<slug>')::uuid (docs/DATA-MODEL.md section 11).

-- ---------------------------------------------------------------------------
-- Users (password 'lapar-local-only'; token columns must be '' or GoTrue cannot sign them in)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, is_anonymous,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token)
select '00000000-0000-0000-0000-000000000000', md5('user:' || k)::uuid, 'authenticated', 'authenticated',
  case when anon then null else k || '@lapar.test' end,
  case when anon then '' else extensions.crypt('lapar-local-only', extensions.gen_salt('bf')) end,
  case when anon then null else now() end, anon,
  case when anon then '{}'::jsonb else '{"provider":"email","providers":["email"]}'::jsonb end, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', '', ''
from (values ('admin', false), ('owner-a', false), ('owner-b', false), ('outsider', false),
             ('device-a', true), ('device-b', true)) v (k, anon);

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email',
  now(), now(), now()
from auth.users u where u.email like '%@lapar.test';

insert into public.platform_admins (user_id) values (md5('user:admin')::uuid);

-- ---------------------------------------------------------------------------
-- Shops, owners, stations
-- ---------------------------------------------------------------------------
insert into public.shops (id, name, slug, plan_id, approval_mode, pickup_board_token) values
  (md5('shop:a')::uuid, 'Kopitiam Teras', 'kopitiam-teras', 'basic', 'first_order', null),
  (md5('shop:b')::uuid, 'Restoran Contoh', 'restoran-contoh', 'pro', 'first_order', 'lapar-local-b-pickup-01');
insert into public.shop_owners (shop_id, user_id) values
  (md5('shop:a')::uuid, md5('user:owner-a')::uuid), (md5('shop:b')::uuid, md5('user:owner-b')::uuid);

insert into public.stations (id, shop_id, name, sort) values
  (md5('station:a:kitchen')::uuid, md5('shop:a')::uuid, 'Kitchen', 0),
  (md5('station:b:kitchen')::uuid, md5('shop:b')::uuid, 'Kitchen', 0),
  (md5('station:b:drinks')::uuid, md5('shop:b')::uuid, 'Drinks', 1);

-- ---------------------------------------------------------------------------
-- Menu (both shops); shop B adds Sets, time windows and translations
-- ---------------------------------------------------------------------------
create temp table _cat (slug text, name text, ms text, zh text, sort int, win_from time, win_to time);
insert into _cat values
  ('sets', 'Sets', 'Set', '套餐', 0, null, null),
  ('drinks', 'Drinks', 'Minuman', '饮料', 1, null, null),
  ('breakfast', 'Breakfast', 'Sarapan', '早餐', 2, '06:00', '11:30'),
  ('rice', 'Rice', 'Nasi', '饭类', 3, null, null),
  ('noodles', 'Noodles', 'Mi', '面类', 4, '11:00', '21:00'),
  ('sides', 'Sides', 'Sampingan', '小食', 5, null, null);

insert into public.categories (id, shop_id, name, translations, sort, available_from, available_to)
select md5('cat:' || s.k || ':' || c.slug)::uuid, md5('shop:' || s.k)::uuid, c.name,
  case when s.k = 'b' then jsonb_build_object('ms', jsonb_build_object('name', c.ms), 'zh', jsonb_build_object('name', c.zh)) else '{}' end,
  c.sort, case when s.k = 'b' then c.win_from end, case when s.k = 'b' then c.win_to end
from (values ('a'), ('b')) s (k) join _cat c on (s.k = 'b' or c.slug <> 'sets');

update public.shops s set nudge_category_id = md5('cat:' || k || ':drinks')::uuid
from (values ('a'), ('b')) v (k) where s.id = md5('shop:' || k)::uuid;

create temp table _item (slug text, cat text, name text, ms text, zh text, price int, sort int);
insert into _item values
  ('teh-tarik', 'drinks', 'Teh tarik', null, '拉茶', 220, 1),
  ('kopi', 'drinks', 'Kopi', null, '咖啡', 200, 2),
  ('kopi-o', 'drinks', 'Kopi O', null, '咖啡乌', 180, 3),
  ('milo-ais', 'drinks', 'Milo ais', null, '冰美禄', 320, 4),
  ('teh-o-ais-limau', 'drinks', 'Teh O ais limau', null, '冰柠檬茶', 280, 5),
  ('sirap-bandung', 'drinks', 'Sirap bandung', null, '玫瑰露奶', 280, 6),
  ('roti-canai', 'breakfast', 'Roti canai', null, '印度煎饼', 150, 1),
  ('roti-telur', 'breakfast', 'Roti telur', null, '鸡蛋煎饼', 250, 2),
  ('kaya-toast', 'breakfast', 'Kaya toast', 'Roti bakar kaya', '咖椰吐司', 300, 3),
  ('half-boiled-eggs', 'breakfast', 'Half-boiled eggs', 'Telur separuh masak', '半生熟蛋', 300, 4),
  ('nasi-lemak', 'rice', 'Nasi lemak', null, '椰浆饭', 550, 1),
  ('nasi-lemak-ayam', 'rice', 'Nasi lemak ayam goreng', null, '炸鸡椰浆饭', 1050, 2),
  ('nasi-goreng-kampung', 'rice', 'Nasi goreng kampung', null, '甘榜炒饭', 800, 3),
  ('nasi-ayam', 'rice', 'Nasi ayam', null, '鸡饭', 850, 4),
  ('mee-goreng-mamak', 'noodles', 'Mee goreng mamak', null, '嘛嘛炒面', 750, 1),
  ('char-kuey-teow', 'noodles', 'Char kuey teow', null, '炒粿条', 900, 2),
  ('mee-rebus', 'noodles', 'Mee rebus', null, '卤面', 700, 3),
  ('telur-mata', 'sides', 'Telur mata', null, '荷包蛋', 120, 1),
  ('ayam-goreng', 'sides', 'Ayam goreng', null, '炸鸡', 500, 2),
  ('extra-kari', 'sides', 'Extra kari', 'Kari tambahan', '加咖喱', 100, 3);

-- Combos are inserted after the shop B plan lets them through (it is Pro, so a plain insert works).
insert into public.items (id, shop_id, category_id, station_id, name, translations, price_sen, sort, is_combo)
select md5('item:' || s.k || ':' || i.slug)::uuid, md5('shop:' || s.k)::uuid, md5('cat:' || s.k || ':' || i.cat)::uuid,
  case when s.k = 'b' and i.cat = 'drinks' then md5('station:b:drinks')::uuid else md5('station:' || s.k || ':kitchen')::uuid end,
  i.name,
  case when s.k = 'b' then jsonb_build_object('ms', jsonb_build_object('name', coalesce(i.ms, i.name), 'description', ''),
                                              'zh', jsonb_build_object('name', i.zh, 'description', '')) else '{}' end,
  i.price, i.sort, false
from (values ('a'), ('b')) s (k) cross join _item i;

insert into public.items (id, shop_id, category_id, station_id, name, description, translations, price_sen, sort, is_combo) values
  (md5('item:b:set-a')::uuid, md5('shop:b')::uuid, md5('cat:b:sets')::uuid, md5('station:b:kitchen')::uuid,
   'Set A', 'Nasi lemak + Teh tarik', '{"ms":{"name":"Set A","description":""},"zh":{"name":"套餐A","description":""}}', 700, 1, true),
  (md5('item:b:set-b')::uuid, md5('shop:b')::uuid, md5('cat:b:sets')::uuid, md5('station:b:kitchen')::uuid,
   'Set B', 'Roti canai + Kopi', '{"ms":{"name":"Set B","description":""},"zh":{"name":"套餐B","description":""}}', 320, 2, true);

insert into public.combo_components (shop_id, combo_item_id, item_id, qty, sort) values
  (md5('shop:b')::uuid, md5('item:b:set-a')::uuid, md5('item:b:nasi-lemak')::uuid, 1, 1),
  (md5('shop:b')::uuid, md5('item:b:set-a')::uuid, md5('item:b:teh-tarik')::uuid, 1, 2),
  (md5('shop:b')::uuid, md5('item:b:set-b')::uuid, md5('item:b:roti-canai')::uuid, 1, 1),
  (md5('shop:b')::uuid, md5('item:b:set-b')::uuid, md5('item:b:kopi')::uuid, 1, 2);

-- Option groups and options
create temp table _group (item text, slug text, name text, min_s int, max_s int, sort int);
insert into _group values
  ('teh-tarik', 'temp', 'Panas / Ais', 1, 1, 1), ('teh-tarik', 'sweet', 'Manis', 0, 1, 2), ('teh-tarik', 'pack', 'Bungkus', 0, 1, 3),
  ('kopi', 'temp', 'Panas / Ais', 1, 1, 1), ('kopi', 'sweet', 'Manis', 0, 1, 2), ('kopi', 'pack', 'Bungkus', 0, 1, 3),
  ('kopi-o', 'temp', 'Panas / Ais', 1, 1, 1), ('kopi-o', 'sweet', 'Manis', 0, 1, 2), ('kopi-o', 'pack', 'Bungkus', 0, 1, 3),
  ('milo-ais', 'sweet', 'Manis', 0, 1, 1),
  ('roti-canai', 'kuah', 'Kuah', 1, 1, 1), ('roti-canai', 'add', 'Tambah', 0, 2, 2),
  ('nasi-lemak', 'add', 'Tambah', 0, 3, 1),
  ('mee-goreng-mamak', 'spice', 'Pedas', 1, 1, 1), ('mee-goreng-mamak', 'add', 'Tambah', 0, 1, 2),
  ('char-kuey-teow', 'spice', 'Pedas', 1, 1, 1);
create temp table _opt (item text, grp text, slug text, name text, delta int, sort int);
insert into _opt values
  ('teh-tarik', 'temp', 'panas', 'Panas', 0, 1), ('teh-tarik', 'temp', 'ais', 'Ais', 30, 2),
  ('teh-tarik', 'sweet', 'kurang-manis', 'Kurang manis', 0, 1), ('teh-tarik', 'sweet', 'kosong', 'Kosong', 0, 2),
  ('teh-tarik', 'pack', 'bungkus', 'Bungkus', 20, 1),
  ('kopi', 'temp', 'panas', 'Panas', 0, 1), ('kopi', 'temp', 'ais', 'Ais', 30, 2),
  ('kopi', 'sweet', 'kurang-manis', 'Kurang manis', 0, 1), ('kopi', 'sweet', 'kosong', 'Kosong', 0, 2),
  ('kopi', 'pack', 'bungkus', 'Bungkus', 20, 1),
  ('kopi-o', 'temp', 'panas', 'Panas', 0, 1), ('kopi-o', 'temp', 'ais', 'Ais', 30, 2),
  ('kopi-o', 'sweet', 'kurang-manis', 'Kurang manis', 0, 1), ('kopi-o', 'sweet', 'kosong', 'Kosong', 0, 2),
  ('kopi-o', 'pack', 'bungkus', 'Bungkus', 20, 1),
  ('milo-ais', 'sweet', 'kurang-manis', 'Kurang manis', 0, 1), ('milo-ais', 'sweet', 'kosong', 'Kosong', 0, 2),
  ('roti-canai', 'kuah', 'dhal', 'Dhal', 0, 1), ('roti-canai', 'kuah', 'kari', 'Kari', 0, 2), ('roti-canai', 'kuah', 'campur', 'Campur', 0, 3),
  ('roti-canai', 'add', 'telur', 'Telur', 100, 1), ('roti-canai', 'add', 'bawang', 'Bawang', 50, 2),
  ('nasi-lemak', 'add', 'telur-mata', 'Telur mata', 120, 1), ('nasi-lemak', 'add', 'ayam-goreng', 'Ayam goreng', 500, 2),
  ('nasi-lemak', 'add', 'sambal', 'Sambal extra', 50, 3),
  ('mee-goreng-mamak', 'spice', 'biasa', 'Biasa', 0, 1), ('mee-goreng-mamak', 'spice', 'pedas', 'Pedas', 0, 2),
  ('mee-goreng-mamak', 'spice', 'tak-pedas', 'Tak pedas', 0, 3), ('mee-goreng-mamak', 'add', 'telur', 'Telur', 100, 1),
  ('char-kuey-teow', 'spice', 'biasa', 'Biasa', 0, 1), ('char-kuey-teow', 'spice', 'pedas', 'Pedas', 0, 2),
  ('char-kuey-teow', 'spice', 'tak-pedas', 'Tak pedas', 0, 3);

insert into public.modifier_groups (id, shop_id, item_id, name, min_select, max_select, sort)
select md5('group:' || s.k || ':' || g.item || ':' || g.slug)::uuid, md5('shop:' || s.k)::uuid,
  md5('item:' || s.k || ':' || g.item)::uuid, g.name, g.min_s, g.max_s, g.sort
from (values ('a'), ('b')) s (k) cross join _group g;
insert into public.modifier_options (id, shop_id, group_id, name, price_delta_sen, sort)
select md5('option:' || s.k || ':' || o.item || ':' || o.slug)::uuid, md5('shop:' || s.k)::uuid,
  md5('group:' || s.k || ':' || o.item || ':' || o.grp)::uuid, o.name, o.delta, o.sort
from (values ('a'), ('b')) s (k) cross join _opt o;

-- Manual pairings (both shops)
create temp table _pair (src text, dst text, pos int);
insert into _pair values
  ('nasi-lemak', 'teh-tarik', 1), ('nasi-lemak', 'telur-mata', 2), ('nasi-lemak', 'ayam-goreng', 3),
  ('roti-canai', 'teh-tarik', 1), ('roti-canai', 'telur-mata', 2), ('roti-canai', 'extra-kari', 3),
  ('kaya-toast', 'half-boiled-eggs', 1), ('kaya-toast', 'kopi', 2);
insert into public.item_pairings (shop_id, source_item_id, suggested_item_id, position)
select md5('shop:' || s.k)::uuid, md5('item:' || s.k || ':' || p.src)::uuid, md5('item:' || s.k || ':' || p.dst)::uuid, p.pos
from (values ('a'), ('b')) s (k) cross join _pair p;

-- Shop B: happy hour promo 20% off four drinks, 14:00-17:00 every day
insert into public.promos (id, shop_id, name, translations, discount_type, discount_value, start_time, end_time) values
  (md5('promo:b:happy-hour')::uuid, md5('shop:b')::uuid, 'Happy hour',
   '{"ms":{"name":"Waktu happy"},"zh":{"name":"欢乐时光"}}', 'percent', 20, '14:00', '17:00');
insert into public.promo_items (shop_id, promo_id, item_id)
select md5('shop:b')::uuid, md5('promo:b:happy-hour')::uuid, md5('item:b:' || slug)::uuid
from (values ('teh-tarik'), ('kopi'), ('kopi-o'), ('milo-ais')) v (slug);

-- ---------------------------------------------------------------------------
-- Tables, staff (PINs are bcrypt hashes of throwaway local PINs)
-- ---------------------------------------------------------------------------
insert into public.tables (id, shop_id, label, token, sort)
select md5('table:a:' || lpad(n::text, 2, '0'))::uuid, md5('shop:a')::uuid, 'Table ' || n,
  'lapar-local-a-table-' || lpad(n::text, 2, '0'), n
from generate_series(1, 10) n;
insert into public.tables (id, shop_id, label, token, sort)
select md5('table:b:' || lpad(n::text, 2, '0'))::uuid, md5('shop:b')::uuid, 'Table ' || n,
  'lapar-local-b-table-' || lpad(n::text, 2, '0'), n
from generate_series(1, 4) n;
insert into public.tables (id, shop_id, label, kind, token, sort) values
  (md5('table:b:counter-1')::uuid, md5('shop:b')::uuid, 'Counter', 'counter', 'lapar-local-b-counter-1', 5);

insert into public.staff (id, shop_id, name) values
  (md5('staff:a:aminah')::uuid, md5('shop:a')::uuid, 'Aminah'),
  (md5('staff:a:ravi')::uuid, md5('shop:a')::uuid, 'Ravi'),
  (md5('staff:b:siti')::uuid, md5('shop:b')::uuid, 'Siti');
insert into public.staff_pins (staff_id, shop_id, pin_hash)
select s.id, s.shop_id, extensions.crypt(v.pin, extensions.gen_salt('bf', 8))
from (values ('aminah', '1234'), ('ravi', '5678'), ('siti', '2468')) v (slug, pin)
join public.staff s on s.id = md5('staff:' || case when v.slug = 'siti' then 'b' else 'a' end || ':' || v.slug)::uuid;

drop table _cat, _item, _group, _opt, _pair;

-- ---------------------------------------------------------------------------
-- History (card M2-E, DATA-MODEL 11): MYT days today-30 .. today-1, deterministic (setseed once, fixed call order).
-- One closed tab per order, approved 1-3 min after creation, every line served, paid in full. Ids are md5('hist:...').
-- ---------------------------------------------------------------------------
create function pg_temp.hist_pick(p_slugs text[]) returns text language plpgsql as $$
declare
  v_w constant jsonb := '{"nasi-lemak":3,"roti-canai":3,"kaya-toast":2,"mee-goreng-mamak":2,"teh-tarik":3,"kopi":2}';
  v_total numeric := 0; v_r numeric; v_s text;
begin
  foreach v_s in array p_slugs loop v_total := v_total + coalesce((v_w ->> v_s)::numeric, 1); end loop;
  v_r := random() * v_total;
  foreach v_s in array p_slugs loop
    v_r := v_r - coalesce((v_w ->> v_s)::numeric, 1);
    if v_r < 0 then return v_s; end if;
  end loop;
  return p_slugs[array_length(p_slugs, 1)];
end $$;

-- Inserts one served line (combo lines never get ready_at, like the real board) and returns its id and serve time.
create function pg_temp.hist_line(p_k text, p_n int, p_order uuid, p_no int, p_item uuid, p_kind public.line_kind,
  p_parent uuid, p_qty int, p_price int, p_from uuid, p_approved timestamptz, p_created timestamptz,
  out o_id uuid, out o_served timestamptz)
language plpgsql as $$
declare v_item public.items; v_ready timestamptz; v_drink boolean;
begin
  select * into v_item from public.items where id = p_item;
  v_drink := v_item.category_id = md5('cat:' || p_k || ':drinks')::uuid;
  v_ready := p_approved + (case when v_drink then 2 + floor(random() * 4) else 3 + floor(random() * 13) end) * interval '1 minute';
  o_served := v_ready + interval '1 minute';
  o_id := md5('hist:line:' || p_k || ':' || p_n || ':' || p_no)::uuid;
  insert into public.order_items (id, shop_id, order_id, line_no, kind, parent_line_id, item_id, name_snapshot, list_price_sen,
    unit_price_sen, qty, station_id, status, status_changed_at, ready_at, served_at, suggested_from_item_id, created_at)
  values (o_id, v_item.shop_id, p_order, p_no, p_kind, p_parent, v_item.id, v_item.name, p_price, p_price, p_qty, v_item.station_id,
    'served', o_served, case when p_kind = 'combo' then null else v_ready end, o_served, p_from, p_created);
end $$;

do $$
declare
  v_pairs constant jsonb := '{"nasi-lemak":[["teh-tarik",0.6]],"roti-canai":[["teh-tarik",0.5],["extra-kari",0.3]],
    "kaya-toast":[["half-boiled-eggs",0.7],["kopi",0.6]]}';
  v_weights constant numeric[] := array[0,0,0,0,0,0,0, 3,5,4,1.5,2,5,5,2,1,1,1.5,3,3,2,0.5, 0,0]; -- per MYT hour 0..23
  v_breakfast constant text[] := array['roti-canai','roti-telur','kaya-toast','half-boiled-eggs'];
  v_mains constant text[] := array['nasi-lemak','nasi-lemak-ayam','nasi-goreng-kampung','nasi-ayam','mee-goreng-mamak','char-kuey-teow','mee-rebus'];
  v_drinks constant text[] := array['teh-tarik','kopi','kopi-o','milo-ais','teh-o-ais-limau','sirap-bandung'];
  v_sides constant text[] := array['telur-mata','ayam-goreng','extra-kari'];
  v_k text; v_shop uuid; v_staff uuid; v_tables uuid[]; v_day date; v_cnt int; v_n int;
  v_ago int; v_o int; v_l int; v_hr numeric; v_hour int; v_created timestamptz; v_approved timestamptz; v_last timestamptz;
  v_slugs text[]; v_froms text[]; v_main text; v_has_drink boolean; v_p jsonb; v_side text;
  v_tab uuid; v_order uuid; v_line record; v_comp record; v_no int; v_qty int; v_total int; v_item public.items;
  v_method public.paid_method; v_round int; v_paid timestamptz; v_parent uuid; v_r numeric;
begin
  perform setseed(0.42);
  foreach v_k in array array['a', 'b'] loop
    v_shop := md5('shop:' || v_k)::uuid;
    v_staff := md5('staff:' || v_k || ':' || case when v_k = 'a' then 'aminah' else 'siti' end)::uuid;
    -- Table 2 of shop A stays free of history: 011_place_order asserts it has no orders or tabs.
    v_tables := array(select id from public.tables where shop_id = v_shop and kind = 'table' and active
      and id <> md5('table:a:02')::uuid order by sort);
    v_n := 0;
    for v_ago in reverse 30..1 loop
      v_day := public.myt_today() - v_ago;
      v_cnt := round((18 + floor(random() * 13)) * case when extract(isodow from v_day) >= 6 then 1.3 else 1 end);
      for v_o in 1..v_cnt loop
        v_n := v_n + 1;
        v_hr := random() * (select sum(w) from unnest(v_weights) w);
        v_hour := 0;
        while v_hour < 23 and v_hr >= v_weights[v_hour + 1] loop v_hr := v_hr - v_weights[v_hour + 1]; v_hour := v_hour + 1; end loop;
        v_created := (v_day::timestamp + make_interval(hours => v_hour, secs => floor(random() * 3600))) at time zone 'Asia/Kuala_Lumpur';
        v_approved := v_created + make_interval(secs => 60 + floor(random() * 121));

        v_main := pg_temp.hist_pick(case when v_hour < 11 then v_breakfast else v_mains end);
        v_slugs := array[v_main]; v_froms := array[null::text]; v_has_drink := false;
        for v_p in select value from jsonb_array_elements(coalesce(v_pairs -> v_main, '[]'::jsonb)) loop
          if random() < (v_p ->> 1)::numeric then
            v_slugs := v_slugs || (v_p ->> 0);
            -- no suggestions from shop B nasi lemak: 011_place_order counts them
            v_froms := v_froms || case when random() < 0.25 and not (v_k = 'b' and v_main = 'nasi-lemak') then v_main end;
            v_has_drink := v_has_drink or (v_p ->> 0) = any (v_drinks);
          end if;
        end loop;
        if not v_has_drink and random() < 0.8 then v_slugs := v_slugs || pg_temp.hist_pick(v_drinks); v_froms := v_froms || null::text; end if;
        if random() < 0.3 then
          v_side := pg_temp.hist_pick(v_sides);
          if not v_side = any (v_slugs) then v_slugs := v_slugs || v_side; v_froms := v_froms || null::text; end if;
        end if;
        if v_k = 'b' and random() < 0.1 then
          v_slugs := v_slugs || (case when random() < 0.5 then 'set-a' else 'set-b' end); v_froms := v_froms || null::text;
        end if;

        v_tab := md5('hist:tab:' || v_k || ':' || v_n)::uuid;
        v_order := md5('hist:order:' || v_k || ':' || v_n)::uuid;
        insert into public.tabs (id, shop_id, table_id, kind, status, opened_at, updated_at)
          values (v_tab, v_shop, v_tables[1 + floor(random() * cardinality(v_tables))::int], 'table', 'open', v_created, v_created);
        insert into public.orders (id, shop_id, tab_id, status, created_at, approved_at, approved_by_staff_id)
          values (v_order, v_shop, v_tab, 'approved', v_created, v_approved, v_staff);

        v_no := 0; v_total := 0; v_last := v_approved;
        for v_l in 1..cardinality(v_slugs) loop
          select * into v_item from public.items where id = md5('item:' || v_k || ':' || v_slugs[v_l])::uuid;
          v_qty := case when random() < 0.12 then 2 else 1 end;
          v_no := v_no + 1;
          select * into v_line from pg_temp.hist_line(v_k, v_n, v_order, v_no, v_item.id,
            (case when v_item.is_combo then 'combo' else 'item' end)::public.line_kind, null, v_qty, v_item.price_sen,
            case when v_froms[v_l] is null then null else md5('item:' || v_k || ':' || v_froms[v_l])::uuid end, v_approved, v_created);
          v_parent := v_line.o_id;
          v_last := greatest(v_last, v_line.o_served);
          v_total := v_total + v_qty * v_item.price_sen;
          if v_item.is_combo then
            for v_comp in select cc.item_id, cc.qty from public.combo_components cc where cc.combo_item_id = v_item.id order by cc.sort loop
              v_no := v_no + 1;
              select * into v_line from pg_temp.hist_line(v_k, v_n, v_order, v_no, v_comp.item_id, 'component', v_parent,
                v_qty * v_comp.qty, 0, null, v_approved, v_created);
              v_last := greatest(v_last, v_line.o_served);
            end loop;
          end if;
        end loop;

        v_r := random();
        v_method := case when v_r < 0.6 then 'cash' when v_r < 0.9 then 'duitnow' else 'card' end;
        v_round := case when v_method = 'cash' then public.round_cash(v_total) - v_total else 0 end;
        v_paid := v_last + make_interval(mins => 1 + floor(random() * 4)::int);
        insert into public.tab_payments (id, shop_id, tab_id, method, amount_sen, rounding_sen, created_at, created_by_staff_id)
          values (md5('hist:pay:' || v_k || ':' || v_n)::uuid, v_shop, v_tab, v_method, v_total, v_round, v_paid, v_staff);
        update public.tabs set status = 'closed', closed_at = v_paid, paid_total_sen = v_total, rounding_sen = v_round,
          updated_at = v_paid where id = v_tab;
      end loop;
    end loop;
  end loop;
end $$;

-- DATA-MODEL 11 ends the seed with `select public.refresh_auto_pairings();`. It is left out because 003 and 010 insert
-- auto_pairings rows for shop B at fixed keys; 034_auto_pairings_cron calls it itself.
