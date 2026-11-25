create schema if not exists private;
create extension if not exists btree_gist with schema extensions;

create type public.staff_role as enum ('owner','branch_manager','trainer','staff');
create type public.member_status as enum ('active','frozen','expired','cancelled');
create type public.membership_status as enum ('active','paused','expired','cancelled');

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  default_currency char(3) not null default 'SEK' check (default_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  unique (id, club_id)
);

-- Club staff and their roles (branch_id = null means all branches, owner only)
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.staff_role not null,
  branch_id uuid,
  created_at timestamptz not null default now(),
  unique (club_id, user_id),
  foreign key (branch_id, club_id) references public.branches(id, club_id),
  check ((role = 'owner') or branch_id is not null)
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  branch_id uuid not null,
  user_id uuid references auth.users(id) on delete set null, -- member login from the app
  full_name text not null,
  phone text,
  email text,
  birth_date date,
  status public.member_status not null default 'active',
  joined_at date not null default current_date,
  created_at timestamptz not null default now(),
  unique (id, club_id),
  unique (club_id, user_id),
  foreign key (branch_id, club_id) references public.branches(id, club_id)
);

create table public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  branch_id uuid,               -- null = available in all branches
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  duration_days integer not null check (duration_days > 0),
  active boolean not null default true,
  unique (id, club_id),
  foreign key (branch_id, club_id) references public.branches(id, club_id)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null,
  plan_id uuid not null,
  branch_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  status public.membership_status not null default 'active',
  price_cents integer not null check (price_cents >= 0),  -- snapshot at purchase time
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  foreign key (member_id, club_id) references public.members(id, club_id),
  foreign key (plan_id, club_id) references public.membership_plans(id, club_id),
  foreign key (branch_id, club_id) references public.branches(id, club_id),
  exclude using gist (
    member_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status in ('active','paused'))
);

create index on public.staff (user_id);
create index on public.members (club_id, branch_id);
create index on public.members (user_id);
create index on public.memberships (club_id, member_id);
create index on public.memberships (club_id, ends_on);

-- RLS helper functions
grant usage on schema private to authenticated;

create function private.has_role(c uuid, roles public.staff_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.club_id = c and s.user_id = (select auth.uid()) and s.role = any(roles)
  );
$$;

create function private.can_access_branch(c uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.club_id = c and s.user_id = (select auth.uid())
      and (s.role = 'owner' or s.branch_id = b)
  );
$$;

create function private.is_club_staff(c uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.club_id = c and s.user_id = (select auth.uid()));
$$;

create function private.is_club_member(c uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.club_id = c and m.user_id = (select auth.uid()));
$$;

create function private.is_own_member(c uuid, m uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members x
    where x.id = m and x.club_id = c and x.user_id = (select auth.uid())
  );
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- Create a new club: club + first branch + current user as owner
create function public.create_club(
  p_name text, p_slug text,
  p_currency char(3) default 'SEK',
  p_first_branch text default 'Main'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.clubs (name, slug, default_currency)
    values (p_name, p_slug, p_currency) returning id into v_club;
  insert into public.branches (club_id, name)
    values (v_club, p_first_branch);
  insert into public.staff (club_id, user_id, role)
    values (v_club, auth.uid(), 'owner');
  return v_club;
end;
$$;
revoke execute on function public.create_club(text, text, character, text) from public, anon;
grant execute on function public.create_club(text, text, character, text) to authenticated;

alter table public.clubs enable row level security;
alter table public.branches enable row level security;
alter table public.staff enable row level security;
alter table public.members enable row level security;
alter table public.membership_plans enable row level security;
alter table public.memberships enable row level security;

-- clubs / branches
create policy clubs_staff_read on public.clubs for select using (private.is_club_staff(id));
create policy clubs_member_read on public.clubs for select using (private.is_club_member(id));
create policy clubs_owner_update on public.clubs for update
  using (private.has_role(id, array['owner']::public.staff_role[]))
  with check (private.has_role(id, array['owner']::public.staff_role[]));
create policy branches_read on public.branches for select using (private.can_access_branch(club_id, id));
create policy branches_owner_write on public.branches for all
  using (private.has_role(club_id, array['owner']::public.staff_role[]))
  with check (private.has_role(club_id, array['owner']::public.staff_role[]));

-- staff: every staff member sees colleagues, only owner edits
create policy staff_read on public.staff for select using (private.is_club_staff(club_id));
create policy staff_owner_write on public.staff for all
  using (private.has_role(club_id, array['owner']::public.staff_role[]))
  with check (private.has_role(club_id, array['owner']::public.staff_role[]));

-- members: staff by branch, member reads own record
create policy members_read on public.members for select using (private.can_access_branch(club_id, branch_id));
create policy members_self_read on public.members for select using (user_id = (select auth.uid()));
create policy members_write on public.members for all
  using (private.can_access_branch(club_id, branch_id)
         and private.has_role(club_id, array['owner','branch_manager','staff']::public.staff_role[]))
  with check (private.can_access_branch(club_id, branch_id)
         and private.has_role(club_id, array['owner','branch_manager','staff']::public.staff_role[]));

-- memberships: same logic
create policy memberships_read on public.memberships for select using (private.can_access_branch(club_id, branch_id));
create policy memberships_self_read on public.memberships for select using (private.is_own_member(club_id, member_id));
create policy memberships_write on public.memberships for all
  using (private.can_access_branch(club_id, branch_id)
         and private.has_role(club_id, array['owner','branch_manager','staff']::public.staff_role[]))
  with check (private.can_access_branch(club_id, branch_id)
         and private.has_role(club_id, array['owner','branch_manager','staff']::public.staff_role[]));

-- plans: staff and members read, owner/manager write
create policy plans_staff_read on public.membership_plans for select using (private.is_club_staff(club_id));
create policy plans_member_read on public.membership_plans for select
  using (active and private.is_club_member(club_id));
create policy plans_write on public.membership_plans for all
  using (private.has_role(club_id, array['owner','branch_manager']::public.staff_role[]))
  with check (private.has_role(club_id, array['owner','branch_manager']::public.staff_role[]));
