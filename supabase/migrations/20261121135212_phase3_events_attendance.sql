-- ===== Club timezone (needed for "today" and event dates) =====
alter table public.clubs add column timezone text not null default 'UTC';

alter table public.audit_log drop constraint audit_log_domain_check;
alter table public.audit_log add constraint audit_log_domain_check
  check (domain in ('finance','access','events','attendance'));

alter table public.staff add unique (id, club_id);

drop function public.create_club(text, text, character, text);
create function public.create_club(
  p_name text, p_slug text, p_currency char(3),
  p_first_branch text default 'Main', p_timezone text default 'UTC'
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
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone';
  end if;
  insert into public.clubs (name, slug, default_currency, timezone)
    values (trim(p_name), lower(trim(p_slug)), upper(p_currency), p_timezone) returning id into v_club;
  insert into public.branches (club_id, name) values (v_club, trim(p_first_branch));
  insert into public.staff (club_id, user_id, role) values (v_club, auth.uid(), 'owner');
  return v_club;
end;
$$;
revoke execute on function public.create_club(text, text, character, text, text) from public, anon;
grant execute on function public.create_club(text, text, character, text, text) to authenticated;

-- ===== Types =====
create type public.event_status as enum ('scheduled','cancelled');
create type public.registration_status as enum ('registered','waitlisted','cancelled','attended','no_show');
create type public.checkin_method as enum ('staff','qr');

-- ===== Tables =====
create table public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  branch_id uuid not null,
  trainer_staff_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 1000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity between 1 and 1000),
  status public.event_status not null default 'scheduled',
  cancel_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '1 day'),
  check (status <> 'cancelled' or cancel_reason is not null),
  unique (id, club_id),
  foreign key (branch_id, club_id) references public.branches(id, club_id),
  foreign key (trainer_staff_id, club_id) references public.staff(id, club_id)
    on delete set null (trainer_staff_id)
);

create sequence public.event_reg_seq;

create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  branch_id uuid not null,
  event_id uuid not null,
  member_id uuid not null,
  status public.registration_status not null,
  queue_no bigint not null default nextval('public.event_reg_seq'),
  registered_at timestamptz not null default now(),
  cancelled_at timestamptz,
  attended_at timestamptz,
  marked_by uuid,
  unique (event_id, member_id),
  foreign key (event_id, club_id) references public.events(id, club_id),
  foreign key (member_id, club_id) references public.members(id, club_id),
  foreign key (branch_id, club_id) references public.branches(id, club_id)
);

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  branch_id uuid not null,
  member_id uuid not null,
  membership_id uuid not null,
  method public.checkin_method not null,
  checked_in_by uuid,
  checked_in_at timestamptz not null default now(),
  foreign key (branch_id, club_id) references public.branches(id, club_id),
  foreign key (member_id, club_id) references public.members(id, club_id),
  foreign key (membership_id, club_id) references public.memberships(id, club_id)
);

-- Short-lived, single-use QR tokens (only the hash is stored; no client access)
create table public.checkin_tokens (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  member_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (member_id, club_id) references public.members(id, club_id) on delete cascade
);

create index on public.events (club_id, branch_id, starts_at);
create index on public.event_registrations (event_id, status, queue_no);
create index on public.event_registrations (member_id);
create index on public.checkins (club_id, branch_id, checked_in_at desc);
create index on public.checkins (member_id, checked_in_at desc);
create index on public.checkin_tokens (member_id);
create index on public.checkin_tokens (expires_at);

-- ===== Guards =====
create function private.event_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'events cannot be deleted; cancel them instead' using errcode = '42501';
  end if;
  if new.club_id <> old.club_id or new.branch_id <> old.branch_id then
    raise exception 'event club and branch are immutable' using errcode = '42501';
  end if;
  if old.status = 'cancelled'
     and (to_jsonb(new) - 'trainer_staff_id') is distinct from (to_jsonb(old) - 'trainer_staff_id') then
    raise exception 'a cancelled event cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger event_guard_bud before update or delete on public.events
  for each row execute function private.event_guard();
create trigger event_no_truncate before truncate on public.events
  for each statement execute function private.deny_change();

create function private.event_trainer_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.trainer_staff_id is not null and not exists (
       select 1 from public.staff s
       where s.id = new.trainer_staff_id and s.club_id = new.club_id
         and s.role in ('trainer','branch_manager','owner')
         and (s.role = 'owner' or s.branch_id = new.branch_id)) then
    raise exception 'trainer must be a trainer or manager of this branch' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger event_trainer_check_biu before insert or update on public.events
  for each row execute function private.event_trainer_check();

create function private.registration_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'registrations cannot be deleted; cancel them instead' using errcode = '42501';
  end if;
  if new.club_id <> old.club_id or new.branch_id <> old.branch_id
     or new.event_id <> old.event_id or new.member_id <> old.member_id then
    raise exception 'registration event and member are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger registration_guard_bud before update or delete on public.event_registrations
  for each row execute function private.registration_guard();
create trigger registration_no_truncate before truncate on public.event_registrations
  for each statement execute function private.deny_change();

create trigger checkins_no_change before update or delete on public.checkins
  for each row execute function private.deny_change();
create trigger checkins_no_truncate before truncate on public.checkins
  for each statement execute function private.deny_change();

-- ===== RLS: read-only for clients; writes only through functions =====
alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.checkins enable row level security;
alter table public.checkin_tokens enable row level security;  -- no policies on purpose

revoke all on public.events, public.event_registrations, public.checkins, public.checkin_tokens from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.events, public.event_registrations, public.checkins, public.checkin_tokens from authenticated;
revoke select on public.checkin_tokens from authenticated;
revoke all on sequence public.event_reg_seq from anon, authenticated;

create policy no_anonymous on public.events as restrictive for all to authenticated using (private.real_user());
create policy no_anonymous on public.event_registrations as restrictive for all to authenticated using (private.real_user());
create policy no_anonymous on public.checkins as restrictive for all to authenticated using (private.real_user());

create policy events_staff_read on public.events for select to authenticated
  using (private.can_access_branch(club_id, branch_id));
create policy events_member_read on public.events for select to authenticated
  using (private.is_club_member(club_id));
create policy registrations_staff_read on public.event_registrations for select to authenticated
  using (private.can_access_branch(club_id, branch_id));
create policy registrations_self_read on public.event_registrations for select to authenticated
  using (private.is_own_member(club_id, member_id));
create policy checkins_staff_read on public.checkins for select to authenticated
  using (private.can_access_branch(club_id, branch_id));
create policy checkins_self_read on public.checkins for select to authenticated
  using (private.is_own_member(club_id, member_id));

-- ===== Helpers =====
create function private.club_tz(c uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select timezone from public.clubs where id = c), 'UTC');
$$;

create function private.club_today(c uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone private.club_tz(c))::date;
$$;

-- An active membership (of an active member) covering the given date, or null
create function private.covering_membership(c uuid, m uuid, d date) returns uuid
language sql stable security definer set search_path = '' as $$
  select ms.id
  from public.memberships ms
  join public.members mem on mem.id = ms.member_id and mem.club_id = ms.club_id
  where ms.club_id = c and ms.member_id = m and ms.status = 'active' and mem.status = 'active'
    and d between ms.starts_on and ms.ends_on
  order by ms.ends_on desc limit 1;
$$;

create function private.can_manage_event(c uuid, b uuid, t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_branch_role(c, b, array['owner','branch_manager']::public.staff_role[])
      or exists (select 1 from public.staff s
                 where s.id = t and s.club_id = c and s.role = 'trainer'
                   and s.user_id = (select auth.uid()));
$$;

create function private.event_taken(p_event uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.event_registrations
  where event_id = p_event and status in ('registered','attended','no_show');
$$;

-- Promote waitlisted members while seats are free (caller holds the event row lock)
create function private.promote_waitlist(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_cap int; v_reg uuid;
begin
  select capacity into v_cap from public.events where id = p_event and status = 'scheduled';
  if v_cap is null then return; end if;
  loop
    exit when private.event_taken(p_event) >= v_cap;
    select id into v_reg from public.event_registrations
      where event_id = p_event and status = 'waitlisted' order by queue_no limit 1;
    exit when v_reg is null;
    update public.event_registrations set status = 'registered' where id = v_reg;
  end loop;
end;
$$;

-- Shared check-in logic (membership must be valid today; one check-in per 10 minutes)
create function private.do_checkin(p_club uuid, p_branch uuid, p_member uuid, p_method public.checkin_method)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ms uuid; v_id uuid;
begin
  v_ms := private.covering_membership(p_club, p_member, private.club_today(p_club));
  if v_ms is null then
    raise exception 'no active membership today';
  end if;
  if exists (select 1 from public.checkins
             where member_id = p_member and checked_in_at > now() - interval '10 minutes') then
    raise exception 'member already checked in recently';
  end if;
  insert into public.checkins (club_id, branch_id, member_id, membership_id, method, checked_in_by)
    values (p_club, p_branch, p_member, v_ms, p_method, auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

-- ===== Public functions =====
create function public.create_event(
  p_branch_id uuid, p_title text, p_description text, p_trainer_staff_id uuid,
  p_starts_at timestamptz, p_ends_at timestamptz, p_capacity integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_id uuid;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into v_club from public.branches where id = p_branch_id;
  if v_club is null or not (
       private.has_branch_role(v_club, p_branch_id, array['owner','branch_manager']::public.staff_role[])
       or exists (select 1 from public.staff s
                  where s.id = p_trainer_staff_id and s.club_id = v_club and s.role = 'trainer'
                    and s.branch_id = p_branch_id and s.user_id = auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_starts_at <= now() then raise exception 'event must start in the future'; end if;

  insert into public.events (club_id, branch_id, trainer_staff_id, title, description,
      starts_at, ends_at, capacity, created_by)
    values (v_club, p_branch_id, p_trainer_staff_id, trim(p_title), nullif(trim(coalesce(p_description,'')), ''),
      p_starts_at, p_ends_at, p_capacity, auth.uid())
    returning id into v_id;
  perform private.write_audit(v_club, 'events', 'event_create', v_id,
    jsonb_build_object('branch_id', p_branch_id, 'capacity', p_capacity, 'starts_at', p_starts_at));
  return v_id;
end;
$$;

create function public.update_event(
  p_event_id uuid, p_title text, p_description text, p_trainer_staff_id uuid,
  p_starts_at timestamptz, p_ends_at timestamptz, p_capacity integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ev public.events%rowtype; v_is_manager boolean;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ev from public.events where id = p_event_id for update;
  if not found or not private.can_manage_event(v_ev.club_id, v_ev.branch_id, v_ev.trainer_staff_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_ev.status <> 'scheduled' or v_ev.starts_at <= now() then
    raise exception 'only upcoming scheduled events can be edited';
  end if;
  v_is_manager := private.has_branch_role(v_ev.club_id, v_ev.branch_id,
                    array['owner','branch_manager']::public.staff_role[]);
  if not v_is_manager and p_trainer_staff_id is distinct from v_ev.trainer_staff_id then
    raise exception 'only managers can change the trainer' using errcode = '42501';
  end if;
  if p_starts_at <= now() then raise exception 'event must start in the future'; end if;
  if p_capacity < private.event_taken(p_event_id) then
    raise exception 'capacity is below the number of registered members';
  end if;

  update public.events
     set title = trim(p_title), description = nullif(trim(coalesce(p_description,'')), ''),
         trainer_staff_id = p_trainer_staff_id, starts_at = p_starts_at, ends_at = p_ends_at,
         capacity = p_capacity
   where id = p_event_id;
  perform private.promote_waitlist(p_event_id);
  perform private.write_audit(v_ev.club_id, 'events', 'event_update', p_event_id,
    jsonb_build_object('capacity', p_capacity, 'starts_at', p_starts_at));
end;
$$;

create function public.cancel_event(p_event_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ev public.events%rowtype; v_n int;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ev from public.events where id = p_event_id for update;
  if not found or not private.can_manage_event(v_ev.club_id, v_ev.branch_id, v_ev.trainer_staff_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_ev.status <> 'scheduled' then raise exception 'event is not scheduled'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 160 then
    raise exception 'a reason (1-160 characters) is required';
  end if;

  update public.event_registrations set status = 'cancelled', cancelled_at = now()
   where event_id = p_event_id and status in ('registered','waitlisted');
  get diagnostics v_n = row_count;
  update public.events set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_event_id;
  perform private.write_audit(v_ev.club_id, 'events', 'event_cancel', p_event_id,
    jsonb_build_object('reason', trim(p_reason), 'registrations_cancelled', v_n));
end;
$$;

create function public.register_for_event(p_event_id uuid, p_member_id uuid default null)
returns public.registration_status
language plpgsql security definer set search_path = '' as $$
declare
  v_ev public.events%rowtype; v_member uuid; v_reg public.event_registrations%rowtype;
  v_status public.registration_status;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ev from public.events where id = p_event_id for update;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;

  if p_member_id is null then
    select id into v_member from public.members where club_id = v_ev.club_id and user_id = auth.uid();
  else
    select id into v_member from public.members
      where id = p_member_id and club_id = v_ev.club_id
        and (user_id = auth.uid()
             or private.has_branch_role(v_ev.club_id, v_ev.branch_id,
                  array['owner','branch_manager','staff']::public.staff_role[]));
  end if;
  if v_member is null then raise exception 'forbidden' using errcode = '42501'; end if;

  if v_ev.status <> 'scheduled' or v_ev.starts_at <= now() then
    raise exception 'event is not open for registration';
  end if;
  if private.covering_membership(v_ev.club_id, v_member,
       (v_ev.starts_at at time zone private.club_tz(v_ev.club_id))::date) is null then
    raise exception 'no active membership covering the event date';
  end if;

  select * into v_reg from public.event_registrations where event_id = p_event_id and member_id = v_member for update;
  if found and v_reg.status <> 'cancelled' then
    raise exception 'already registered';
  end if;

  v_status := case when private.event_taken(p_event_id) < v_ev.capacity
                   then 'registered'::public.registration_status
                   else 'waitlisted'::public.registration_status end;
  if found then
    update public.event_registrations
       set status = v_status, queue_no = nextval('public.event_reg_seq'),
           registered_at = now(), cancelled_at = null
     where id = v_reg.id;
  else
    insert into public.event_registrations (club_id, branch_id, event_id, member_id, status)
      values (v_ev.club_id, v_ev.branch_id, p_event_id, v_member, v_status);
  end if;
  return v_status;
end;
$$;

create function public.cancel_registration(p_event_id uuid, p_member_id uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ev public.events%rowtype; v_member uuid; v_reg public.event_registrations%rowtype;
  v_is_staff boolean;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ev from public.events where id = p_event_id for update;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  v_is_staff := private.has_branch_role(v_ev.club_id, v_ev.branch_id,
                  array['owner','branch_manager','staff']::public.staff_role[]);

  if p_member_id is null then
    select id into v_member from public.members where club_id = v_ev.club_id and user_id = auth.uid();
  else
    select id into v_member from public.members
      where id = p_member_id and club_id = v_ev.club_id and (user_id = auth.uid() or v_is_staff);
  end if;
  if v_member is null then raise exception 'forbidden' using errcode = '42501'; end if;

  if (v_is_staff and now() >= v_ev.ends_at) or (not v_is_staff and now() >= v_ev.starts_at) then
    raise exception 'registration can no longer be cancelled';
  end if;
  select * into v_reg from public.event_registrations
    where event_id = p_event_id and member_id = v_member and status in ('registered','waitlisted') for update;
  if not found then raise exception 'no active registration'; end if;

  update public.event_registrations set status = 'cancelled', cancelled_at = now() where id = v_reg.id;
  if v_reg.status = 'registered' and v_ev.status = 'scheduled' then
    perform private.promote_waitlist(p_event_id);
  end if;
end;
$$;

create function public.mark_attendance(p_event_id uuid, p_member_id uuid, p_attended boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_ev public.events%rowtype; v_reg public.event_registrations%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ev from public.events where id = p_event_id for update;
  if not found or not private.can_manage_event(v_ev.club_id, v_ev.branch_id, v_ev.trainer_staff_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_ev.status <> 'scheduled' then raise exception 'event is not scheduled'; end if;
  if now() < v_ev.starts_at - interval '15 minutes' or now() > v_ev.ends_at + interval '24 hours' then
    raise exception 'attendance can only be marked from 15 minutes before the start until 24 hours after the end';
  end if;
  select * into v_reg from public.event_registrations
    where event_id = p_event_id and member_id = p_member_id
      and status in ('registered','attended','no_show') for update;
  if not found then raise exception 'member has no confirmed registration'; end if;

  update public.event_registrations
     set status = case when p_attended then 'attended'::public.registration_status
                       else 'no_show'::public.registration_status end,
         attended_at = case when p_attended then now() else null end,
         marked_by = auth.uid()
   where id = v_reg.id;
  perform private.write_audit(v_ev.club_id, 'attendance', 'attendance_mark', p_event_id,
    jsonb_build_object('member_id', p_member_id, 'attended', p_attended));
end;
$$;

create function public.check_in_member(p_member_id uuid, p_branch_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_club uuid;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into v_club from public.branches where id = p_branch_id;
  if v_club is null or not private.has_branch_role(v_club, p_branch_id,
       array['owner','branch_manager','staff']::public.staff_role[])
     or not exists (select 1 from public.members where id = p_member_id and club_id = v_club) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.do_checkin(v_club, p_branch_id, p_member_id, 'staff');
end;
$$;

-- Member side: a 60-second single-use token to show as a QR code
create function public.create_checkin_token(p_club_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_member uuid; v_token text;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_member from public.members where club_id = p_club_id and user_id = auth.uid();
  if v_member is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if exists (select 1 from public.checkin_tokens
             where member_id = v_member and created_at > now() - interval '5 seconds') then
    raise exception 'too many requests';
  end if;
  delete from public.checkin_tokens
   where member_id = v_member and (used_at is null or expires_at < now() - interval '1 hour');
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.checkin_tokens (club_id, member_id, token_hash, expires_at)
    values (p_club_id, v_member, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now() + interval '60 seconds');
  return v_token;
end;
$$;

-- Staff side: scan the member's QR token at a branch
create function public.check_in_with_token(p_token text, p_branch_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_tok public.checkin_tokens%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into v_club from public.branches where id = p_branch_id;
  if v_club is null or not private.has_branch_role(v_club, p_branch_id,
       array['owner','branch_manager','staff']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_tok from public.checkin_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token,''), 'UTF8')), 'hex')
      and club_id = v_club and used_at is null and expires_at > now()
    for update;
  if not found then raise exception 'invalid or expired token'; end if;
  update public.checkin_tokens set used_at = now() where id = v_tok.id;
  return private.do_checkin(v_club, p_branch_id, v_tok.member_id, 'qr');
end;
$$;

-- ===== Grants =====
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function public.create_event(uuid, text, text, uuid, timestamptz, timestamptz, integer) from public, anon;
revoke execute on function public.update_event(uuid, text, text, uuid, timestamptz, timestamptz, integer) from public, anon;
revoke execute on function public.cancel_event(uuid, text) from public, anon;
revoke execute on function public.register_for_event(uuid, uuid) from public, anon;
revoke execute on function public.cancel_registration(uuid, uuid) from public, anon;
revoke execute on function public.mark_attendance(uuid, uuid, boolean) from public, anon;
revoke execute on function public.check_in_member(uuid, uuid) from public, anon;
revoke execute on function public.create_checkin_token(uuid) from public, anon;
revoke execute on function public.check_in_with_token(text, uuid) from public, anon;
grant execute on function public.create_event(uuid, text, text, uuid, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.update_event(uuid, text, text, uuid, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.cancel_event(uuid, text) to authenticated;
grant execute on function public.register_for_event(uuid, uuid) to authenticated;
grant execute on function public.cancel_registration(uuid, uuid) to authenticated;
grant execute on function public.mark_attendance(uuid, uuid, boolean) to authenticated;
grant execute on function public.check_in_member(uuid, uuid) to authenticated;
grant execute on function public.create_checkin_token(uuid) to authenticated;
grant execute on function public.check_in_with_token(text, uuid) to authenticated;
