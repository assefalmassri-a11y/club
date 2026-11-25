
create or replace function public.claim_member_invite(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv private.member_invites%rowtype; v_code text; v_n int;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select count(*) from private.invite_attempts where user_id = auth.uid() and not ok
        and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'too many attempts' using errcode = '42501';
  end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into v_inv from private.member_invites
   where code_hash = encode(sha256(convert_to(v_code, 'utf8')), 'hex')
     and used_at is null and expires_at > now() for update;
  if not found then
    insert into private.invite_attempts (user_id, ok) values (auth.uid(), false);
    return null;  -- no exception: the failed attempt must persist for throttling
  end if;
  perform set_config('app.member_claim', '1', true);
  update public.members set user_id = auth.uid()
   where id = v_inv.member_id and club_id = v_inv.club_id and user_id is null;
  get diagnostics v_n = row_count;
  perform set_config('app.member_claim', '0', true);
  if v_n = 0 then
    insert into private.invite_attempts (user_id, ok) values (auth.uid(), false);
    return null;
  end if;
  update private.member_invites set used_at = now() where id = v_inv.id;
  insert into private.invite_attempts (user_id, ok) values (auth.uid(), true);
  return v_inv.club_id;
end; $$;
