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
