create table public.member_measurements(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  measured_on date not null default current_date,
  weight_kg numeric(5,1) check (weight_kg between 20 and 400),
  body_fat_pct numeric(4,1) check (body_fat_pct between 1 and 70),
  waist_cm numeric(5,1) check (waist_cm between 20 and 300),
  chest_cm numeric(5,1) check (chest_cm between 20 and 300),
  note text check (char_length(note)<=300),
  created_at timestamptz not null default now(),
  check (weight_kg is not null or body_fat_pct is not null or waist_cm is not null or chest_cm is not null));
create index on public.member_measurements(member_id,measured_on desc);

create table public.workout_logs(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  done_on date not null default current_date,
  exercise text not null check (char_length(exercise) between 1 and 80),
  sets int check (sets between 1 and 50),
  reps int check (reps between 1 and 1000),
  weight_kg numeric(6,1) check (weight_kg between 0 and 1000),
  note text check (char_length(note)<=300),
  created_at timestamptz not null default now());
create index on public.workout_logs(member_id,done_on desc);

create or replace function private.can_see_tracking(c uuid,m uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.real_user() and (
    private.is_own_member(c,m)
    or exists(select 1 from public.members x where x.id=m and x.club_id=c
        and private.has_branch_role(c,x.branch_id,array['owner','branch_manager','staff']::public.staff_role[]))
    or exists(select 1 from public.trainer_assignments ta join public.staff s on s.id=ta.trainer_staff_id
        where ta.member_id=m and ta.club_id=c and ta.ended_at is null and s.user_id=auth.uid()))
$$;
revoke all on function private.can_see_tracking from public,anon;
grant execute on function private.can_see_tracking to authenticated;

alter table public.member_measurements enable row level security;
alter table public.workout_logs enable row level security;
create policy mm_read on public.member_measurements for select to authenticated using (private.can_see_tracking(club_id,member_id));
create policy mm_ins on public.member_measurements for insert to authenticated with check (private.is_own_member(club_id,member_id));
create policy mm_del on public.member_measurements for delete to authenticated using (private.is_own_member(club_id,member_id));
create policy wl_read on public.workout_logs for select to authenticated using (private.can_see_tracking(club_id,member_id));
create policy wl_ins on public.workout_logs for insert to authenticated with check (private.is_own_member(club_id,member_id));
create policy wl_del on public.workout_logs for delete to authenticated using (private.is_own_member(club_id,member_id));
grant select,insert,delete on public.member_measurements,public.workout_logs to authenticated;
