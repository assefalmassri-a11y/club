-- Phase 26: reset the transaction-local guard flags right after the guarded update, so a later statement in the same transaction cannot reuse them.
create or replace function public.set_club_color(p_club uuid, p_color text) returns void
language plpgsql security definer set search_path = '' as $$
declare o jsonb; col text := lower(p_color);
begin
  if not private.real_user() or not private.has_role(p_club, array['owner']::public.staff_role[]) or not private.mfa_ok(p_club) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if col is not null then
    if col !~ '^#[0-9a-f]{6}$' then raise exception 'invalid colour' using errcode = '22023'; end if;
    select value into o from public.platform_settings where key = 'branding';
    if not (o -> 'palette') ? col and not coalesce((o ->> 'allow_custom')::boolean, false) then
      raise exception 'colour not allowed' using errcode = '22023';
    end if;
  end if;
  perform set_config('club.brand', '1', true);
  update public.clubs set brand_color = col where id = p_club;
  perform set_config('club.brand', '', true);
  perform private.write_audit(p_club, 'access', 'club_color', p_club, jsonb_build_object('color', col));
end; $$;

create or replace function public.set_club_logo(p_club uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.real_user() or not private.has_role(p_club, array['owner']::public.staff_role[]) or not private.mfa_ok(p_club) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_path is not null then
    if p_path <> p_club::text || '/logo.png' then raise exception 'invalid path' using errcode = '22023'; end if;
    if not coalesce((select (value ->> 'allow_logo')::boolean from public.platform_settings where key = 'branding'), false) then
      raise exception 'logos are disabled' using errcode = '22023';
    end if;
  end if;
  perform set_config('club.brand', '1', true);
  update public.clubs set logo_path = p_path where id = p_club;
  perform set_config('club.brand', '', true);
  perform private.write_audit(p_club, 'access', 'club_logo', p_club, jsonb_build_object('set', p_path is not null));
end; $$;

create or replace function public.approve_members(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare m record; n int := 0;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform set_config('club.review', '1', true);
  for m in select id, club_id, branch_id from public.members where id = any (p_ids) and review_status = 'pending' for update loop
    if not private.has_branch_role(m.club_id, m.branch_id, array['owner', 'branch_manager']::public.staff_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    update public.members set review_status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = now() where id = m.id;
    perform private.write_audit(m.club_id, 'access', 'member_reviewed', m.id, '{}'::jsonb);
    n := n + 1;
  end loop;
  perform set_config('club.review', '', true);
  return n;
end; $$;
