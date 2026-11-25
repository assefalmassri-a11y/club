-- Phase 19: platform layer (club subscriptions, plan limits, platform admins). Billing stays manual.

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated, public;

create table public.club_plans (
  code text primary key check (code ~ '^[a-z0-9_]{2,20}$'),
  name text not null,
  max_branches int check (max_branches is null or max_branches > 0),   -- null = unlimited
  max_members int check (max_members is null or max_members > 0),      -- null = unlimited
  price_cents bigint check (price_cents is null or price_cents >= 0),  -- null = not priced yet
  currency char(3),
  active boolean not null default true
);
alter table public.club_plans enable row level security;
revoke all on public.club_plans from anon, authenticated, public;
insert into public.club_plans (code, name, max_branches, max_members) values
  ('starter', 'Starter', 1, 100),
  ('pro', 'Pro', 3, 500),
  ('unlimited', 'Unlimited', null, null);

create table public.club_subscriptions (
  club_id uuid primary key references public.clubs(id) on delete restrict,
  plan_code text not null references public.club_plans(code),
  status text not null check (status in ('trial', 'active', 'past_due', 'suspended')),
  trial_ends_on date,
  current_period_end date,
  notes text check (notes is null or length(notes) <= 500),
  updated_at timestamptz not null default now()
);
alter table public.club_subscriptions enable row level security;
revoke all on public.club_subscriptions from anon, authenticated, public;

create table public.platform_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  club_id uuid,
  action text not null,
  detail jsonb
);
alter table public.platform_log enable row level security;
revoke all on public.platform_log from anon, authenticated, public;

-- Existing clubs keep working: active on the unlimited plan. New clubs start a 14-day trial on starter.
insert into public.club_subscriptions (club_id, plan_code, status)
select id, 'unlimited', 'active' from public.clubs;

create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

create function private.club_subscription_biu() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.club_subscriptions (club_id, plan_code, status, trial_ends_on)
  values (new.id, 'starter', 'trial', current_date + 14)
  on conflict (club_id) do nothing;
  return new;
end; $$;
create trigger club_subscription_ai after insert on public.clubs
  for each row execute function private.club_subscription_biu();

-- Is the club allowed to add more of something? Reads and existing data are never blocked.
create function private.club_can_grow(c uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare s public.club_subscriptions;
begin
  select * into s from public.club_subscriptions where club_id = c;
  if not found then return null; end if;
  if s.status = 'suspended' then return 'subscription_suspended'; end if;
  if s.status = 'trial' and s.trial_ends_on is not null and s.trial_ends_on < current_date then return 'trial_expired'; end if;
  return null;
end; $$;

create function private.limit_members_bi() returns trigger
language plpgsql security definer set search_path = '' as $$
declare why text; lim int;
begin
  why := private.club_can_grow(new.club_id);
  if why is not null then raise exception '%', why using errcode = '42501'; end if;
  select p.max_members into lim from public.club_subscriptions s join public.club_plans p on p.code = s.plan_code where s.club_id = new.club_id;
  if lim is not null and (select count(*) from public.members m where m.club_id = new.club_id) >= lim then
    raise exception 'member_limit_reached' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger members_limit_bi before insert on public.members
  for each row execute function private.limit_members_bi();

create function private.limit_branches_bi() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; why text; subs int;
begin
  select count(*) into subs from public.club_subscriptions where club_id = new.club_id;
  if subs = 0 then return new; end if;  -- club being created: subscription row appears after insert
  why := private.club_can_grow(new.club_id);
  if why is not null then raise exception '%', why using errcode = '42501'; end if;
  select p.max_branches into lim from public.club_subscriptions s join public.club_plans p on p.code = s.plan_code where s.club_id = new.club_id;
  if lim is not null and (select count(*) from public.branches b where b.club_id = new.club_id) >= lim then
    raise exception 'branch_limit_reached' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger branches_limit_bi before insert on public.branches
  for each row execute function private.limit_branches_bi();

-- Owner/manager view of their club's subscription and usage.
create function public.my_club_subscription(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not private.has_role(p_club, array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object('plan', p.code, 'plan_name', p.name, 'status', s.status, 'trial_ends_on', s.trial_ends_on,
      'current_period_end', s.current_period_end, 'max_branches', p.max_branches, 'max_members', p.max_members,
      'branches', (select count(*) from public.branches b where b.club_id = p_club),
      'members', (select count(*) from public.members m where m.club_id = p_club),
      'blocked', private.club_can_grow(p_club))
    into r
    from public.club_subscriptions s join public.club_plans p on p.code = s.plan_code where s.club_id = p_club;
  return r;
end; $$;

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select private.is_platform_admin(); $$;

create function public.platform_list_clubs() returns table (
  club_id uuid, name text, slug text, created_at timestamptz, plan_code text, status text,
  trial_ends_on date, current_period_end date, notes text, branches bigint, members bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select c.id, c.name, c.slug, c.created_at, s.plan_code, s.status, s.trial_ends_on, s.current_period_end, s.notes,
      (select count(*) from public.branches b where b.club_id = c.id),
      (select count(*) from public.members m where m.club_id = c.id)
    from public.clubs c join public.club_subscriptions s on s.club_id = c.id order by c.created_at desc;
end; $$;

create function public.platform_set_subscription(p_club uuid, p_plan text, p_status text, p_trial_ends date, p_period_end date, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.club_subscriptions set plan_code = p_plan, status = p_status, trial_ends_on = p_trial_ends,
    current_period_end = p_period_end, notes = nullif(p_notes, ''), updated_at = now() where club_id = p_club;
  if not found then raise exception 'club_not_found' using errcode = 'P0002'; end if;
  insert into public.platform_log (actor, club_id, action, detail)
  values ((select auth.uid()), p_club, 'set_subscription', jsonb_build_object('plan', p_plan, 'status', p_status, 'trial_ends_on', p_trial_ends, 'period_end', p_period_end));
end; $$;

revoke all on function private.is_platform_admin(), private.club_can_grow(uuid) from public, anon, authenticated;
revoke all on function public.my_club_subscription(uuid), public.is_platform_admin(), public.platform_list_clubs(),
  public.platform_set_subscription(uuid, text, text, date, date, text) from public, anon;
grant execute on function public.my_club_subscription(uuid), public.is_platform_admin(), public.platform_list_clubs(),
  public.platform_set_subscription(uuid, text, text, date, date, text) to authenticated;
