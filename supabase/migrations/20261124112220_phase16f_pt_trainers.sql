create or replace function public.pt_trainers(p_club uuid)
returns table(staff_id uuid,label text) language plpgsql security definer stable set search_path='' as $$
begin
  if not (private.real_user() and (private.is_club_member(p_club) or private.has_role(p_club,array['owner','branch_manager','staff','trainer']::public.staff_role[]))) then
    raise exception 'forbidden' using errcode='42501'; end if;
  return query select s.id, split_part(u.email,'@',1)::text from public.staff s join auth.users u on u.id=s.user_id
    where s.club_id=p_club and s.role='trainer' and exists(select 1 from public.pt_availability a where a.trainer_staff_id=s.id) order by 2;
end $$;
revoke all on function public.pt_trainers from public,anon;
grant execute on function public.pt_trainers to authenticated;
