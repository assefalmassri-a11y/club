create or replace function public.trainer_payroll(p_club uuid,p_from date,p_to date)
returns table(staff_id uuid,email text,currency text,events bigint,attendees bigint,per_event bigint,per_attendee bigint,amount bigint)
language plpgsql security definer stable set search_path='' as $$
declare tz text;
begin
  if not (private.real_user() and private.mfa_ok(p_club) and private.has_role(p_club, array['owner']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  select c.timezone into tz from public.clubs c where c.id=p_club;
  return query
  with ev as (
    select e.id, e.trainer_staff_id,
      (select count(*) from public.event_registrations r where r.event_id=e.id and r.attended_at is not null) att
    from public.events e
    where e.club_id=p_club and e.trainer_staff_id is not null and e.status::text<>'cancelled'
      and e.ends_at < now()
      and (e.starts_at at time zone tz)::date between p_from and p_to),
  agg as (select trainer_staff_id sid, count(*) n, coalesce(sum(att),0) a from ev group by 1)
  select s.id, (select d.email from public.staff_directory(p_club) d where d.id=s.id limit 1)::text,
    coalesce(tr.currency,'SYP')::text, coalesce(agg.n,0)::bigint, coalesce(agg.a,0)::bigint,
    coalesce(tr.per_event,0)::bigint, coalesce(tr.per_attendee,0)::bigint,
    (coalesce(agg.n,0)*coalesce(tr.per_event,0)+coalesce(agg.a,0)*coalesce(tr.per_attendee,0))::bigint
  from public.staff s left join agg on agg.sid=s.id left join public.trainer_rates tr on tr.staff_id=s.id and tr.club_id=p_club
  where s.club_id=p_club and s.role='trainer' order by 2;
end $$;
