create table public.freeze_requests(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  branch_id uuid not null,
  member_id uuid not null references public.members(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  reason text check (char_length(reason)<=300),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  decided_by uuid, decided_at timestamptz);
create unique index freeze_one_pending on public.freeze_requests(member_id) where status='pending';
alter table public.freeze_requests enable row level security;
create policy fr_member_read on public.freeze_requests for select to authenticated using (private.real_user() and private.is_own_member(club_id,member_id));
create policy fr_staff_read on public.freeze_requests for select to authenticated using (private.real_user() and private.has_branch_role(club_id,branch_id,array['owner','branch_manager','staff']::public.staff_role[]));
grant select on public.freeze_requests to authenticated;

create or replace function public.request_freeze(p_member uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare m public.members%rowtype; ms public.memberships%rowtype; rid uuid;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode='42501'; end if;
  select * into m from public.members where id=p_member;
  if not found or not private.is_own_member(m.club_id,m.id) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into ms from public.memberships where member_id=m.id and status='active'
    and starts_on<=private.club_today(m.club_id) and ends_on>=private.club_today(m.club_id) order by ends_on desc limit 1;
  if not found then raise exception 'no_active_membership'; end if;
  insert into public.freeze_requests(club_id,branch_id,member_id,membership_id,reason)
  values(m.club_id,ms.branch_id,m.id,ms.id,left(nullif(trim(p_reason),''),300)) returning id into rid;
  perform private.write_audit(m.club_id,'freeze','request',m.id,'{}'::jsonb);
  return rid;
exception when unique_violation then raise exception 'already_pending';
end $$;

create or replace function public.cancel_freeze_request(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.freeze_requests set status='rejected', decided_at=now()
   where id=p_id and status='pending' and private.real_user() and private.is_own_member(club_id,member_id);
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.decide_freeze(p_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path='' as $$
declare r public.freeze_requests%rowtype;
begin
  select * into r from public.freeze_requests where id=p_id for update;
  if not found or r.status<>'pending' then raise exception 'not_found'; end if;
  if not (private.real_user() and private.has_branch_role(r.club_id,r.branch_id,array['owner','branch_manager','staff']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if p_approve then
    update public.memberships set status='paused' where id=r.membership_id and status='active';
  end if;
  update public.freeze_requests set status=case when p_approve then 'approved' else 'rejected' end, decided_by=auth.uid(), decided_at=now() where id=p_id;
  perform private.write_audit(r.club_id,'freeze',case when p_approve then 'approve' else 'reject' end,r.member_id,'{}'::jsonb);
end $$;

create table public.workout_plans(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  trainer_staff_id uuid references public.staff(id) on delete set null,
  title text not null check (char_length(title) between 1 and 100),
  body text not null check (char_length(body) between 1 and 4000),
  active boolean not null default true,
  created_at timestamptz not null default now());
create unique index plan_one_active on public.workout_plans(member_id) where active;
alter table public.workout_plans enable row level security;
create policy wp_read on public.workout_plans for select to authenticated using (private.can_see_tracking(club_id,member_id));
grant select on public.workout_plans to authenticated;

create or replace function public.save_workout_plan(p_member uuid,p_title text,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare m public.members%rowtype; sid uuid; ok boolean; pid uuid;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode='42501'; end if;
  select * into m from public.members where id=p_member;
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select s.id into sid from public.staff s where s.club_id=m.club_id and s.user_id=auth.uid() limit 1;
  ok := private.has_branch_role(m.club_id,m.branch_id,array['owner','branch_manager']::public.staff_role[])
     or exists(select 1 from public.trainer_assignments ta where ta.member_id=m.id and ta.ended_at is null and ta.trainer_staff_id=sid);
  if not ok then raise exception 'forbidden' using errcode='42501'; end if;
  update public.workout_plans set active=false where member_id=m.id and active;
  insert into public.workout_plans(club_id,member_id,trainer_staff_id,title,body)
  values(m.club_id,m.id,sid,trim(p_title),trim(p_body)) returning id into pid;
  perform private.write_audit(m.club_id,'plan','save',m.id,'{}'::jsonb);
  return pid;
end $$;
revoke all on function public.request_freeze,public.cancel_freeze_request,public.decide_freeze,public.save_workout_plan from public,anon;
grant execute on function public.request_freeze,public.cancel_freeze_request,public.decide_freeze,public.save_workout_plan to authenticated;
