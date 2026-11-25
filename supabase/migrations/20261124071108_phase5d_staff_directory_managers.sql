
create or replace function public.staff_directory(p_club uuid)
returns table(id uuid, user_id uuid, email text, role public.staff_role, branch_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.real_user() or not private.has_role(p_club, array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select s.id, s.user_id, u.email::text, s.role, s.branch_id
      from public.staff s join auth.users u on u.id = s.user_id
     where s.club_id = p_club
       and (private.has_role(p_club, array['owner']::public.staff_role[])
            or exists (select 1 from public.staff ss where ss.club_id = p_club and ss.user_id = auth.uid() and ss.branch_id = s.branch_id))
     order by s.created_at;
end; $$;
