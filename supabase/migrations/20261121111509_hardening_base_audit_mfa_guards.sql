-- ===== 0. Privilege hardening =====
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- ===== 1. Helpers =====
-- A real, non-anonymous signed-in user
create function private.real_user() returns boolean
language sql stable set search_path = '' as $$
  select (select auth.uid()) is not null
     and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false;
$$;

-- Sensitive operations need an MFA session (aal2) unless the club turned it off
alter table public.clubs add column require_mfa boolean not null default true;

create function private.mfa_ok(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clubs where id = c and not require_mfa)
      or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2';
$$;

-- Role check scoped to a branch (owner sees all branches)
create function private.has_branch_role(c uuid, b uuid, roles public.staff_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.club_id = c and s.user_id = (select auth.uid())
      and s.role = any(roles)
      and (s.role = 'owner' or s.branch_id = b)
  );
$$;

-- ===== 2. Input constraints =====
alter table public.clubs add constraint clubs_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
alter table public.clubs add constraint clubs_name_len check (char_length(name) between 1 and 120);
alter table public.branches add constraint branches_name_len check (char_length(name) between 1 and 120);
alter table public.members add constraint members_name_len check (char_length(full_name) between 1 and 120);
alter table public.membership_plans add constraint plans_name_len check (char_length(name) between 1 and 120);
alter table public.membership_plans add constraint plans_price_cap check (price_cents <= 1000000000000);
alter table public.memberships add constraint memberships_price_cap check (price_cents <= 1000000000000);

-- ===== 3. Tamper-evident audit log (append-only, hash chain per club) =====
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  chain_no bigint not null,
  domain text not null check (domain in ('finance','access')),
  actor uuid,
  operation text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  prev_hash text not null,
  hash text not null,
  unique (club_id, chain_no)
);
create index on public.audit_log (club_id, created_at desc);

create function private.audit_hash(
  p_club uuid, p_no bigint, p_domain text, p_actor uuid, p_op text,
  p_target uuid, p_details jsonb, p_at timestamptz, p_prev text
) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(
    p_club::text || '|' || p_no::text || '|' || p_domain || '|' || coalesce(p_actor::text, '') || '|' ||
    p_op || '|' || coalesce(p_target::text, '') || '|' || p_details::text || '|' ||
    extract(epoch from p_at)::text || '|' || p_prev, 'UTF8')), 'hex');
$$;

create function private.audit_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_prev text; v_no bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.club_id::text, 7));
  select hash, chain_no into v_prev, v_no
    from public.audit_log where club_id = new.club_id order by chain_no desc limit 1;
  new.chain_no := coalesce(v_no, 0) + 1;
  new.prev_hash := coalesce(v_prev, 'genesis');
  new.created_at := clock_timestamp();
  new.hash := private.audit_hash(new.club_id, new.chain_no, new.domain, new.actor,
                                 new.operation, new.target_id, new.details, new.created_at, new.prev_hash);
  return new;
end;
$$;
create trigger audit_chain_bi before insert on public.audit_log
  for each row execute function private.audit_chain();

create function private.deny_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% on % is not allowed (append-only)', tg_op, tg_table_name using errcode = '42501';
end;
$$;
create trigger audit_no_update before update or delete on public.audit_log
  for each row execute function private.deny_change();
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function private.deny_change();

-- Single writer for audit rows
create function private.write_audit(p_club uuid, p_domain text, p_op text, p_target uuid, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (club_id, domain, actor, operation, target_id, details)
  values (p_club, p_domain, auth.uid(), p_op, p_target, coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Owners can verify that no audit row was altered, removed or reordered
create function public.verify_audit_chain(p_club_id uuid)
returns table (ok boolean, broken_at bigint)
language plpgsql security definer set search_path = '' as $$
declare r record; v_prev text := 'genesis'; v_n bigint := 0;
begin
  if not private.real_user() or not private.has_role(p_club_id, array['owner']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for r in select * from public.audit_log where club_id = p_club_id order by chain_no loop
    v_n := v_n + 1;
    if r.chain_no <> v_n or r.prev_hash <> v_prev or r.hash <>
       private.audit_hash(r.club_id, r.chain_no, r.domain, r.actor, r.operation,
                          r.target_id, r.details, r.created_at, r.prev_hash) then
      return query select false, r.chain_no;
      return;
    end if;
    v_prev := r.hash;
  end loop;
  return query select true, null::bigint;
end;
$$;

alter table public.audit_log enable row level security;
revoke insert, update, delete on public.audit_log from authenticated;
create policy audit_owner_read on public.audit_log for select to authenticated
  using (private.has_role(club_id, array['owner']::public.staff_role[]));

-- ===== 4. Guards on existing tables =====
-- staff: keep at least one owner, no re-homing, audit every role change
create function private.staff_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.club_id <> old.club_id or new.user_id <> old.user_id) then
    raise exception 'staff club and user are immutable' using errcode = '42501';
  end if;
  if tg_op in ('UPDATE','DELETE') and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (select 1 from public.staff s where s.club_id = old.club_id and s.role = 'owner' and s.id <> old.id) then
    raise exception 'a club must keep at least one owner' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger staff_guard_bud before update or delete on public.staff
  for each row execute function private.staff_guard();

create function private.staff_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.club_id, 'access', 'staff_add', new.id,
      jsonb_build_object('user_id', new.user_id, 'role', new.role, 'branch_id', new.branch_id));
  elsif tg_op = 'UPDATE' then
    if old.role is distinct from new.role or old.branch_id is distinct from new.branch_id then
      perform private.write_audit(new.club_id, 'access', 'staff_change', new.id,
        jsonb_build_object('user_id', new.user_id, 'old_role', old.role, 'new_role', new.role,
                           'old_branch_id', old.branch_id, 'new_branch_id', new.branch_id));
    end if;
  else
    perform private.write_audit(old.club_id, 'access', 'staff_remove', old.id,
      jsonb_build_object('user_id', old.user_id, 'role', old.role, 'branch_id', old.branch_id));
  end if;
  return null;
end;
$$;
create trigger staff_audit_aiud after insert or update or delete on public.staff
  for each row execute function private.staff_audit();

-- members: only owners/branch managers may link or unlink a login
create function private.member_link_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.club_id <> old.club_id then
    raise exception 'member club is immutable' using errcode = '42501';
  end if;
  if auth.uid() is not null and (
       (tg_op = 'INSERT' and new.user_id is not null)
    or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id)) then
    if not private.has_branch_role(new.club_id, new.branch_id,
         array['owner','branch_manager']::public.staff_role[]) then
      raise exception 'only owners or branch managers can link a member to a login' using errcode = '42501';
    end if;
    perform private.write_audit(new.club_id, 'access', 'member_link', new.id,
      jsonb_build_object('user_id', new.user_id));
  end if;
  return new;
end;
$$;
create trigger member_link_guard_biu before insert or update on public.members
  for each row execute function private.member_link_guard();

-- memberships: plan, member and price are frozen after creation; no deletes
create function private.membership_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'memberships cannot be deleted; cancel them instead' using errcode = '42501';
  end if;
  if new.club_id <> old.club_id or new.member_id <> old.member_id or new.plan_id <> old.plan_id
     or new.price_cents <> old.price_cents or new.currency <> old.currency then
    raise exception 'membership plan, member and price are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger membership_guard_bud before update or delete on public.memberships
  for each row execute function private.membership_guard();

-- ===== 5. Restrictive policies =====
do $$
declare t text;
begin
  foreach t in array array['clubs','branches','staff','members','membership_plans','memberships','audit_log'] loop
    execute format('create policy no_anonymous on public.%I as restrictive for all to authenticated using (private.real_user())', t);
  end loop;
  foreach t in array array['staff','branches','membership_plans'] loop
    execute format('create policy mfa_insert on public.%I as restrictive for insert to authenticated with check (private.mfa_ok(club_id))', t);
    execute format('create policy mfa_update on public.%I as restrictive for update to authenticated using (private.mfa_ok(club_id)) with check (private.mfa_ok(club_id))', t);
    execute format('create policy mfa_delete on public.%I as restrictive for delete to authenticated using (private.mfa_ok(club_id))', t);
  end loop;
end $$;
create policy mfa_update on public.clubs as restrictive for update to authenticated
  using (private.mfa_ok(id)) with check (private.mfa_ok(id));

-- ===== 6. create_club: verified, non-anonymous, capped =====
create or replace function public.create_club(
  p_name text, p_slug text, p_currency char(3), p_first_branch text default 'Main'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_club uuid;
begin
  if not private.real_user() then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then
    raise exception 'email must be confirmed first' using errcode = '42501';
  end if;
  if (select count(*) from public.staff where user_id = auth.uid() and role = 'owner') >= 3 then
    raise exception 'club limit reached' using errcode = '42501';
  end if;
  insert into public.clubs (name, slug, default_currency)
    values (trim(p_name), lower(trim(p_slug)), upper(p_currency)) returning id into v_club;
  insert into public.branches (club_id, name) values (v_club, trim(p_first_branch));
  insert into public.staff (club_id, user_id, role) values (v_club, auth.uid(), 'owner');
  return v_club;
end;
$$;

-- ===== 7. Function grants =====
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function public.verify_audit_chain(uuid) from public, anon;
grant execute on function public.verify_audit_chain(uuid) to authenticated;
revoke execute on function public.create_club(text, text, character, text) from public, anon;
grant execute on function public.create_club(text, text, character, text) to authenticated;
