create or replace function public.trainer_report(p_club uuid,p_staff uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare tz text; classes jsonb; pay record; pts jsonb; cl int;
begin
  if not (private.real_user() and private.mfa_ok(p_club) and private.has_role(p_club,array['owner']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.staff where id=p_staff and club_id=p_club and role='trainer') then raise exception 'not_a_trainer'; end if;
  tz := private.club_tz(p_club);
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'starts_at',x.starts_at,'capacity',x.capacity,'registered',x.reg,'attended',x.att,'avg_stars',x.avg,'votes',x.votes) order by x.starts_at),'[]'::jsonb) into classes from (
    select e.id,e.title,e.starts_at,e.capacity,
      (select count(*) from public.event_registrations r where r.event_id=e.id and r.status in ('registered','attended','no_show')) reg,
      (select count(*) from public.event_registrations r where r.event_id=e.id and r.attended_at is not null) att,
      (select round(avg(stars)::numeric,2) from public.event_ratings q where q.event_id=e.id) avg,
      (select count(*) from public.event_ratings q where q.event_id=e.id) votes
    from public.events e where e.club_id=p_club and e.trainer_staff_id=p_staff and e.status::text<>'cancelled' and e.ends_at<now()
      and (e.starts_at at time zone tz)::date between p_from and p_to) x;
  select * into pay from public.trainer_payroll(p_club,p_from,p_to) where staff_id=p_staff;
  select jsonb_build_object('done',count(*) filter (where status='booked' and ends_at<now()),'cancelled',count(*) filter (where status='cancelled'),'upcoming',count(*) filter (where status='booked' and starts_at>now())) into pts
    from public.pt_bookings where trainer_staff_id=p_staff and (starts_at at time zone tz)::date between p_from and p_to;
  select count(*) into cl from public.trainer_assignments where trainer_staff_id=p_staff and ended_at is null;
  return jsonb_build_object('classes',classes,'pt',pts,'clients',cl,
    'pay',jsonb_build_object('currency',pay.currency,'amount',pay.amount,'per_event',pay.per_event,'per_attendee',pay.per_attendee),
    'email',(select d.email from public.staff_directory(p_club) d where d.id=p_staff limit 1));
end $$;
revoke all on function public.trainer_report from public,anon;
grant execute on function public.trainer_report to authenticated;
