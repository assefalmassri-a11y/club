create table public.pt_availability(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  branch_id uuid not null,
  trainer_staff_id uuid not null references public.staff(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  start_time time not null, end_time time not null,
  slot_minutes int not null default 60 check (slot_minutes in (30,45,60,90)),
  check (end_time>start_time));
create table public.pt_bookings(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  branch_id uuid not null,
  trainer_staff_id uuid not null references public.staff(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked','cancelled')),
  created_at timestamptz not null default now());
create unique index pt_slot_unique on public.pt_bookings(trainer_staff_id,starts_at) where status='booked';
alter table public.pt_availability enable row level security;
alter table public.pt_bookings enable row level security;
create policy pta_read on public.pt_availability for select to authenticated using (private.real_user() and (private.is_club_member(club_id) or private.has_role(club_id,array['owner','branch_manager','staff','trainer']::public.staff_role[])));
create policy ptb_member_read on public.pt_bookings for select to authenticated using (private.real_user() and private.is_own_member(club_id,member_id));
create policy ptb_staff_read on public.pt_bookings for select to authenticated using (private.real_user() and (private.nontrainer_scope(club_id,branch_id) or exists(select 1 from public.staff s where s.id=trainer_staff_id and s.user_id=auth.uid())));
grant select on public.pt_availability,public.pt_bookings to authenticated;

create or replace function public.set_pt_availability(p_rows jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare s public.staff%rowtype; r jsonb;
begin
  select * into s from public.staff where user_id=auth.uid() and role='trainer' limit 1;
  if not private.real_user() or not found then raise exception 'forbidden' using errcode='42501'; end if;
  delete from public.pt_availability where trainer_staff_id=s.id;
  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    insert into public.pt_availability(club_id,branch_id,trainer_staff_id,weekday,start_time,end_time,slot_minutes)
    values(s.club_id,s.branch_id,s.id,(r->>'weekday')::int,(r->>'start')::time,(r->>'end')::time,coalesce((r->>'slot')::int,60));
  end loop;
end $$;

create or replace function private.pt_slots(p_trainer uuid,p_from date,p_to date)
returns table(starts_at timestamptz,ends_at timestamptz) language sql stable security definer set search_path='' as $$
  with s as (select st.club_id from public.staff st where st.id=p_trainer),
  tz as (select private.club_tz(s.club_id) z from s),
  days as (select d::date d from generate_series(p_from,least(p_to,p_from+14),interval '1 day') d),
  cand as (
    select ((days.d + (a.start_time + (k*a.slot_minutes||' minutes')::interval)) at time zone (select z from tz)) st,
           a.slot_minutes
    from days join public.pt_availability a on a.trainer_staff_id=p_trainer and a.weekday=extract(dow from days.d)::int
    cross join lateral generate_series(0,(extract(epoch from (a.end_time-a.start_time))/60/a.slot_minutes)::int-1) k)
  select c.st, c.st+(c.slot_minutes||' minutes')::interval from cand c
  where c.st>now()+interval '1 hour'
    and not exists(select 1 from public.pt_bookings b where b.trainer_staff_id=p_trainer and b.starts_at=c.st and b.status='booked')
  order by 1 $$;

create or replace function public.pt_open_slots(p_trainer uuid,p_from date,p_to date)
returns table(starts_at timestamptz,ends_at timestamptz) language plpgsql security definer stable set search_path='' as $$
declare c uuid;
begin
  select club_id into c from public.staff where id=p_trainer;
  if c is null or not private.real_user() or not (private.is_club_member(c) or private.has_role(c,array['owner','branch_manager','staff','trainer']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  return query select * from private.pt_slots(p_trainer,p_from,p_to);
end $$;

create or replace function public.book_pt(p_trainer uuid,p_starts timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.staff%rowtype; m public.members%rowtype; sl record; bid uuid; n int;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode='42501'; end if;
  select * into t from public.staff where id=p_trainer and role='trainer';
  if not found then raise exception 'not_found'; end if;
  select * into m from public.members where club_id=t.club_id and user_id=auth.uid() limit 1;
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  if private.covering_membership(t.club_id,m.id,(p_starts at time zone private.club_tz(t.club_id))::date,coalesce(t.branch_id,m.branch_id)) is null then
    raise exception 'no_active_membership'; end if;
  select count(*) into n from public.pt_bookings where member_id=m.id and status='booked' and starts_at>now();
  if n>=3 then raise exception 'too_many_bookings'; end if;
  select * into sl from private.pt_slots(p_trainer,(p_starts at time zone private.club_tz(t.club_id))::date-1,(p_starts at time zone private.club_tz(t.club_id))::date+1) x where x.starts_at=p_starts;
  if not found then raise exception 'slot_unavailable'; end if;
  begin
    insert into public.pt_bookings(club_id,branch_id,trainer_staff_id,member_id,starts_at,ends_at)
    values(t.club_id,coalesce(t.branch_id,m.branch_id),p_trainer,m.id,sl.starts_at,sl.ends_at) returning id into bid;
  exception when unique_violation then raise exception 'slot_unavailable'; end;
  perform private.write_audit(t.club_id,'pt','book',bid,'{}'::jsonb);
  return bid;
end $$;

create or replace function public.cancel_pt(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.pt_bookings%rowtype; own boolean; tr boolean;
begin
  select * into b from public.pt_bookings where id=p_id and status='booked' for update;
  if not found or not private.real_user() then raise exception 'not_found'; end if;
  own := private.is_own_member(b.club_id,b.member_id);
  tr := exists(select 1 from public.staff s where s.id=b.trainer_staff_id and s.user_id=auth.uid());
  if not (own or tr or private.nontrainer_scope(b.club_id,b.branch_id)) then raise exception 'forbidden' using errcode='42501'; end if;
  if own and not tr and b.starts_at < now()+interval '2 hours' then raise exception 'too_late'; end if;
  update public.pt_bookings set status='cancelled' where id=b.id;
  perform private.write_audit(b.club_id,'pt','cancel',b.id,'{}'::jsonb);
end $$;
revoke all on function public.set_pt_availability,public.pt_open_slots,public.book_pt,public.cancel_pt,private.pt_slots from public,anon;
grant execute on function public.set_pt_availability,public.pt_open_slots,public.book_pt,public.cancel_pt to authenticated;
