create table public.fx_rates(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  currency_from text not null check (currency_from ~ '^[A-Z]{3}$'),
  currency_to text not null check (currency_to ~ '^[A-Z]{3}$' and currency_to<>currency_from),
  rate numeric(18,6) not null check (rate>0),
  valid_on date not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique(club_id,currency_from,currency_to,valid_on));
alter table public.fx_rates enable row level security;
create policy fx_read on public.fx_rates for select to authenticated
  using (private.real_user() and private.has_role(club_id, array['owner','branch_manager','staff']::public.staff_role[]));

create table public.trainer_rates(
  club_id uuid not null references public.clubs(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  per_event bigint not null default 0 check (per_event>=0),
  per_attendee bigint not null default 0 check (per_attendee>=0),
  updated_at timestamptz not null default now(),
  primary key(club_id,staff_id));
alter table public.trainer_rates enable row level security;
create policy tr_read on public.trainer_rates for select to authenticated
  using (private.real_user() and (private.has_role(club_id, array['owner']::public.staff_role[])
    or exists(select 1 from public.staff s where s.id=staff_id and s.user_id=auth.uid())));

create or replace function public.set_fx_rate(p_club uuid,p_from text,p_to text,p_rate numeric,p_on date default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not (private.real_user() and private.mfa_ok(p_club) and private.has_role(p_club, array['owner']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  insert into public.fx_rates(club_id,currency_from,currency_to,rate,valid_on)
  values(p_club,upper(p_from),upper(p_to),p_rate,coalesce(p_on,private.club_today(p_club)))
  on conflict(club_id,currency_from,currency_to,valid_on) do update set rate=excluded.rate, created_by=auth.uid();
  perform private.write_audit(p_club,'fx','set',null,jsonb_build_object('from',upper(p_from),'to',upper(p_to),'rate',p_rate));
end $$;

create or replace function public.set_trainer_rate(p_club uuid,p_staff uuid,p_currency text,p_per_event bigint,p_per_attendee bigint)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not (private.real_user() and private.mfa_ok(p_club) and private.has_role(p_club, array['owner']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.staff where id=p_staff and club_id=p_club and role='trainer') then
    raise exception 'not_a_trainer'; end if;
  insert into public.trainer_rates(club_id,staff_id,currency,per_event,per_attendee)
  values(p_club,p_staff,upper(p_currency),p_per_event,p_per_attendee)
  on conflict(club_id,staff_id) do update set currency=excluded.currency,per_event=excluded.per_event,per_attendee=excluded.per_attendee,updated_at=now();
  perform private.write_audit(p_club,'payroll','set_rate',p_staff,jsonb_build_object('per_event',p_per_event,'per_attendee',p_per_attendee));
end $$;

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
  select s.id, (select d.email from public.staff_directory(p_club) d where d.id=s.id limit 1),
    coalesce(tr.currency,'SYP'), coalesce(agg.n,0)::bigint, coalesce(agg.a,0)::bigint,
    coalesce(tr.per_event,0), coalesce(tr.per_attendee,0),
    coalesce(agg.n,0)*coalesce(tr.per_event,0)+coalesce(agg.a,0)*coalesce(tr.per_attendee,0)
  from public.staff s left join agg on agg.sid=s.id left join public.trainer_rates tr on tr.staff_id=s.id and tr.club_id=p_club
  where s.club_id=p_club and s.role='trainer' order by 2;
end $$;
revoke all on function public.set_fx_rate,public.set_trainer_rate,public.trainer_payroll from public,anon;
grant execute on function public.set_fx_rate,public.set_trainer_rate,public.trainer_payroll to authenticated;
