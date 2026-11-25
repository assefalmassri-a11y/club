create table public.event_ratings(
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  club_id uuid not null,
  stars int not null check (stars between 1 and 5),
  comment text check (char_length(comment)<=300),
  created_at timestamptz not null default now(),
  primary key(event_id,member_id));
alter table public.event_ratings enable row level security;
create policy er_own_read on public.event_ratings for select to authenticated using (private.real_user() and private.is_own_member(club_id,member_id));
grant select on public.event_ratings to authenticated;

create or replace function public.rate_event(p_event uuid,p_stars int,p_comment text)
returns void language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; m uuid;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode='42501'; end if;
  select * into e from public.events where id=p_event;
  if not found or e.ends_at>now() then raise exception 'not_finished'; end if;
  select r.member_id into m from public.event_registrations r join public.members x on x.id=r.member_id
   where r.event_id=p_event and r.attended_at is not null and x.user_id=auth.uid() limit 1;
  if m is null then raise exception 'not_attended'; end if;
  insert into public.event_ratings(event_id,member_id,club_id,stars,comment) values(p_event,m,e.club_id,p_stars,left(nullif(trim(p_comment),''),300))
  on conflict(event_id,member_id) do update set stars=excluded.stars,comment=excluded.comment;
end $$;

create or replace function public.ratings_report(p_club uuid,p_from date,p_to date)
returns table(event_id uuid,title text,starts_at timestamptz,trainer_staff_id uuid,avg_stars numeric,votes bigint)
language plpgsql security definer stable set search_path='' as $$
begin
  if not private.real_user() then raise exception 'forbidden' using errcode='42501'; end if;
  return query
  select e.id,e.title,e.starts_at,e.trainer_staff_id,round(avg(r.stars)::numeric,2),count(*)::bigint
  from public.events e join public.event_ratings r on r.event_id=e.id
  where e.club_id=p_club and e.starts_at::date between p_from and p_to
    and (private.nontrainer_scope(e.club_id,e.branch_id) or private.leads_event(e.id))
  group by e.id order by 5 desc;
end $$;

alter table public.members add column show_on_board boolean not null default false;
create or replace function public.set_board_optin(p_member uuid,p_on boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.members set show_on_board=p_on where id=p_member and private.real_user() and user_id=auth.uid();
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
end $$;

create or replace function public.leaderboard(p_club uuid)
returns table(member_no bigint,first_name text,visits bigint)
language plpgsql security definer stable set search_path='' as $$
declare tz text; first_day date;
begin
  if not (private.real_user() and private.is_club_member(p_club)) then raise exception 'forbidden' using errcode='42501'; end if;
  tz := private.club_tz(p_club); first_day := date_trunc('month',private.club_today(p_club))::date;
  return query
  select m.member_no::bigint, split_part(m.full_name,' ',1), count(*)::bigint
  from public.members m join public.checkins c on c.member_id=m.id
  where m.club_id=p_club and m.show_on_board and (c.checked_in_at at time zone tz)::date>=first_day
  group by m.id order by 3 desc, 1 limit 10;
end $$;

create table public.monthly_reports(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  period date not null check (extract(day from period)=1),
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique(club_id,period));
alter table public.monthly_reports enable row level security;
create policy mr_read on public.monthly_reports for select to authenticated using (private.real_user() and private.has_role(club_id,array['owner']::public.staff_role[]));
grant select on public.monthly_reports to authenticated;

create or replace function private.build_monthly_report(p_club uuid,p_period date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tz text; a date:=p_period; b date:=(p_period+interval '1 month')::date; fin jsonb; res jsonb;
begin
  tz := private.club_tz(p_club);
  select coalesce(jsonb_agg(jsonb_build_object('currency',c,'income',inc,'expense',ex)),'[]'::jsonb) into fin from (
    select trim(currency) c, sum(amount_minor) filter (where kind='income') inc, sum(amount_minor) filter (where kind='expense') ex
    from public.ledger_entries where club_id=p_club and voided_at is null and entry_date>=a and entry_date<b group by 1) x;
  res := jsonb_build_object(
    'finance',fin,
    'new_members',(select count(*) from public.members where club_id=p_club and (created_at at time zone tz)::date>=a and (created_at at time zone tz)::date<b),
    'visits',(select count(*) from public.checkins where club_id=p_club and (checked_in_at at time zone tz)::date>=a and (checked_in_at at time zone tz)::date<b),
    'new_memberships',(select count(*) from public.memberships where club_id=p_club and starts_on>=a and starts_on<b),
    'lapsed',(select count(distinct ms.member_id) from public.memberships ms where ms.club_id=p_club and ms.ends_on>=a and ms.ends_on<b
        and not exists(select 1 from public.memberships m2 where m2.member_id=ms.member_id and m2.status in ('active','paused') and m2.ends_on>=b)),
    'classes',(select count(*) from public.events where club_id=p_club and status<>'cancelled' and (starts_at at time zone tz)::date>=a and (starts_at at time zone tz)::date<b),
    'attendees',(select count(*) from public.event_registrations r join public.events e on e.id=r.event_id where r.club_id=p_club and r.attended_at is not null and (e.starts_at at time zone tz)::date>=a and (e.starts_at at time zone tz)::date<b));
  return res;
end $$;

create or replace function public.generate_monthly_report(p_club uuid,p_period date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare per date:=date_trunc('month',p_period)::date; d jsonb;
begin
  if not (private.real_user() and private.mfa_ok(p_club) and private.has_role(p_club,array['owner']::public.staff_role[])) then raise exception 'forbidden' using errcode='42501'; end if;
  if per>=date_trunc('month',private.club_today(p_club))::date then raise exception 'period_not_finished'; end if;
  d := private.build_monthly_report(p_club,per);
  insert into public.monthly_reports(club_id,period,data) values(p_club,per,d) on conflict(club_id,period) do update set data=excluded.data,created_at=now();
  return d;
end $$;

create or replace function private.monthly_reports_job() returns void
language plpgsql security definer set search_path='' as $$
declare c record; per date;
begin
  for c in select id from public.clubs loop
    if extract(day from private.club_today(c.id))=1 then
      per := (date_trunc('month',private.club_today(c.id))-interval '1 month')::date;
      if not exists(select 1 from public.monthly_reports where club_id=c.id and period=per) then
        insert into public.monthly_reports(club_id,period,data) values(c.id,per,private.build_monthly_report(c.id,per));
        begin
          perform private.push_send(array(select user_id from public.staff where club_id=c.id and role='owner'),'التقرير الشهري','التقرير الشهري جاهز');
        exception when others then null; end;
      end if;
    end if;
  end loop;
end $$;
revoke all on function public.rate_event,public.ratings_report,public.set_board_optin,public.leaderboard,public.generate_monthly_report,private.build_monthly_report,private.monthly_reports_job from public,anon;
grant execute on function public.rate_event,public.ratings_report,public.set_board_optin,public.leaderboard,public.generate_monthly_report to authenticated;
select cron.schedule('monthly-reports','30 6 * * *','select private.monthly_reports_job()');
