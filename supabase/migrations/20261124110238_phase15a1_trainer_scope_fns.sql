create or replace function private.nontrainer_scope(c uuid,b uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff s where s.club_id=c and s.user_id=(select auth.uid())
    and s.role<>'trainer' and (s.role='owner' or s.branch_id=b)) $$;

create or replace function private.can_read_member(c uuid,b uuid,m uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.nontrainer_scope(c,b) or exists(
    select 1 from public.staff s where s.club_id=c and s.user_id=(select auth.uid()) and s.role='trainer' and s.branch_id=b
      and (exists(select 1 from public.trainer_assignments ta where ta.member_id=m and ta.trainer_staff_id=s.id and ta.ended_at is null)
        or exists(select 1 from public.event_registrations r join public.events e on e.id=r.event_id where r.member_id=m and e.trainer_staff_id=s.id))) $$;

create or replace function private.leads_event(ev uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.events e join public.staff s on s.id=e.trainer_staff_id where e.id=ev and s.user_id=(select auth.uid())) $$;
revoke all on function private.nontrainer_scope,private.can_read_member,private.leads_event from public,anon;
grant execute on function private.nontrainer_scope,private.can_read_member,private.leads_event to authenticated;
