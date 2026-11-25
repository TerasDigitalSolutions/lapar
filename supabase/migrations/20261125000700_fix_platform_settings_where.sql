-- admin_set_platform_settings updated its single row without a WHERE clause.
-- PostgREST sessions load pg-safeupdate, which rejects that (error 21000), so
-- saving the "Ask Teras" WhatsApp number failed from the admin screen.
-- create or replace keeps the existing grants.

create or replace function public.admin_set_platform_settings(p_whatsapp_number text) returns void
language plpgsql security definer set search_path = '' volatile
as $$
declare v text;
begin
  perform public.assert_admin();
  v := regexp_replace(coalesce(p_whatsapp_number, ''), '[ +-]', '', 'g');
  if v = '' then v := null;
  elsif v !~ '^[0-9]{8,15}$' then raise exception 'invalid_input' using detail = 'whatsapp_number';
  end if;
  update public.platform_settings
     set whatsapp_number = v, updated_at = now(), updated_by = auth.uid()
   where id = true;
end $$;
