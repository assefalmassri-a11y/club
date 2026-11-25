
create or replace function public.staff_directory(p_club uuid)
returns table(id uuid, user_id uuid, email text, role public.staff_role, branch_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.real_user() or not private.has_role(p_club, array['owner']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select s.id, s.user_id, u.email::text, s.role, s.branch_id
      from public.staff s join auth.users u on u.id = s.user_id
     where s.club_id = p_club order by s.created_at;
end; $$;

create or replace function public.add_staff_by_email(p_club uuid, p_email text, p_role public.staff_role, p_branch uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid;
begin
  if not private.real_user() or not private.has_role(p_club, array['owner']::public.staff_role[])
     or not private.mfa_ok(p_club) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role = 'owner' then raise exception 'cannot add another owner here'; end if;
  if p_branch is null then raise exception 'branch is required'; end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if v_uid is null then raise exception 'no account with this email: ask the person to sign up first'; end if;
  insert into public.staff (club_id, user_id, role, branch_id) values (p_club, v_uid, p_role, p_branch) returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.staff_directory(uuid) from public, anon;
revoke all on function public.add_staff_by_email(uuid, text, public.staff_role, uuid) from public, anon;
grant execute on function public.staff_directory(uuid) to authenticated;
grant execute on function public.add_staff_by_email(uuid, text, public.staff_role, uuid) to authenticated;
