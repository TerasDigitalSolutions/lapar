-- Staff sign in with a secret per-shop staff code plus their PIN (DECISIONS O9). The public slug no longer
-- reaches the PIN check. The code is 8 characters from a 31-character alphabet (no 0, O, 1, I, L), shown as XXXX-XXXX.

-- Internal helper, no grants. A byte mod 31 is very slightly biased (8 of 31 symbols a hair likelier): irrelevant for a 31^8 space.
create function public.new_staff_code() returns text
language sql security definer set search_path = '' volatile
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', get_byte(b, i) % 31 + 1, 1), '')
  from (select extensions.gen_random_bytes(8) b) r, generate_series(0, 7) i
$$;

alter table public.shops add column staff_code text null;
update public.shops set staff_code = public.new_staff_code() where staff_code is null;
alter table public.shops
  alter column staff_code set not null,
  alter column staff_code set default public.new_staff_code(),  -- also covers admin_create_shop
  add constraint shops_staff_code_format check (staff_code ~ '^[A-HJ-KM-NP-Z2-9]{8}$'),
  add constraint shops_staff_code_key unique (staff_code);

-- Replaces the slug version (renamed parameter, so drop and create).
drop function public.claim_staff_session(text, text);
create function public.claim_staff_session(p_staff_code text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' volatile
as $$
declare
  v_shop public.shops;
  v_att public.pin_attempts;
  v_staff uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_shop from public.shops s where s.staff_code = upper(regexp_replace(coalesce(p_staff_code, ''), '[\s-]', '', 'g'));
  -- Unknown code: no shop, so no counter is touched.
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;
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

create function public.get_staff_code(p_shop_id uuid) returns text
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.assert_owner(p_shop_id);
  return (select s.staff_code from public.shops s where s.id = p_shop_id);
end $$;

-- A new code signs every staff device of the shop out.
create function public.regenerate_staff_code(p_shop_id uuid) returns text
language plpgsql security definer set search_path = '' volatile
as $$
declare v_code text;
begin
  perform public.assert_owner(p_shop_id);
  update public.shops set staff_code = public.new_staff_code() where id = p_shop_id returning staff_code into v_code;
  delete from public.staff_sessions where shop_id = p_shop_id;
  return v_code;
end $$;

-- As 0500, plus: a changed PIN ends that person's sessions.
create or replace function public.set_staff_pin(p_staff_id uuid, p_pin text) returns void
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
  delete from public.staff_sessions where shop_id = v_st.shop_id and staff_id = p_staff_id;
end $$;

grant execute on function public.claim_staff_session(text, text), public.get_staff_code(uuid), public.regenerate_staff_code(uuid)
  to authenticated;
