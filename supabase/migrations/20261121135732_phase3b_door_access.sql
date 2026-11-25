-- Door entry: the member scans a rotating QR shown at the door; the server checks the membership
-- and issues a short-lived unlock command that the door integration layer claims.

alter type public.checkin_method add value if not exists 'door';

create table public.doors (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  branch_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  active boolean not null default true,
  secret text not null,                       -- HMAC key of the door display (never readable by clients)
  created_at timestamptz not null default now(),
  unique (id, club_id),
  foreign key (branch_id, club_id) references public.branches(id, club_id)
);

-- Append-only log of every scan (granted or denied)
create table public.door_attempts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  branch_id uuid not null,
  door_id uuid not null,
  user_id uuid,
  member_id uuid,
  granted boolean not null,
  reason text not null,
  created_at timestamptz not null default now(),
  foreign key (door_id, club_id) references public.doors(id, club_id),
  foreign key (branch_id, club_id) references public.branches(id, club_id)
);

-- Unlock commands (claimed by the door integration with the service role only)
create table public.door_commands (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  door_id uuid not null,
  member_id uuid not null,
  attempt_id uuid not null references public.door_attempts(id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (door_id, club_id) references public.doors(id, club_id)
);

create index on public.door_attempts (door_id, created_at desc);
create index on public.door_attempts (user_id, created_at desc);
create index on public.door_commands (door_id, created_at) where consumed_at is null;

-- Guards
create trigger door_attempts_no_change before update or delete on public.door_attempts
  for each row execute function private.deny_change();
create trigger door_attempts_no_truncate before truncate on public.door_attempts
  for each statement execute function private.deny_change();

create function private.door_command_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.expires_at < now() - interval '7 days' then return old; end if;
    raise exception 'door commands can only be purged after 7 days' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'consumed_at') is distinct from (to_jsonb(old) - 'consumed_at')
     or (old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at) then
    raise exception 'door commands are immutable except for consumption' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger door_command_guard_bud before update or delete on public.door_commands
  for each row execute function private.door_command_guard();
create trigger door_command_no_truncate before truncate on public.door_commands
  for each statement execute function private.deny_change();

-- RLS and privileges
alter table public.doors enable row level security;
alter table public.door_attempts enable row level security;
alter table public.door_commands enable row level security;  -- no policies on purpose

revoke all on public.doors, public.door_attempts, public.door_commands from anon, authenticated;
grant select (id, club_id, branch_id, name, active, created_at) on public.doors to authenticated;  -- never the secret
grant select on public.door_attempts to authenticated;

create policy no_anonymous on public.doors as restrictive for all to authenticated using (private.real_user());
create policy no_anonymous on public.door_attempts as restrictive for all to authenticated using (private.real_user());
create policy doors_manager_read on public.doors for select to authenticated
  using (private.has_branch_role(club_id, branch_id, array['owner','branch_manager']::public.staff_role[]));
create policy door_attempts_manager_read on public.door_attempts for select to authenticated
  using (private.has_branch_role(club_id, branch_id, array['owner','branch_manager']::public.staff_role[]));
create policy door_attempts_self_read on public.door_attempts for select to authenticated
  using (user_id = (select auth.uid()));

-- Rotating code: first 12 hex chars of HMAC-SHA256(key = door secret, message = floor(unix_seconds / 30) as text)
create function private.door_code(p_secret text, p_step bigint) returns text
language sql immutable set search_path = '' as $$
  select substr(encode(extensions.hmac(p_step::text, p_secret, 'sha256'), 'hex'), 1, 12);
$$;

-- ===== Door administration (owner / branch manager, MFA required) =====
create function public.create_door(p_branch_id uuid, p_name text)
returns table (door_id uuid, secret text)
language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_id uuid; v_secret text;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into v_club from public.branches where id = p_branch_id;
  if v_club is null or not private.has_branch_role(v_club, p_branch_id,
       array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.mfa_ok(v_club) then raise exception 'MFA required' using errcode = '42501'; end if;
  v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.doors (club_id, branch_id, name, secret)
    values (v_club, p_branch_id, trim(p_name), v_secret) returning id into v_id;
  perform private.write_audit(v_club, 'access', 'door_create', v_id, jsonb_build_object('branch_id', p_branch_id));
  return query select v_id, v_secret;
end;
$$;

create function public.rotate_door_secret(p_door_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_door public.doors%rowtype; v_secret text;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_door from public.doors where id = p_door_id for update;
  if not found or not private.has_branch_role(v_door.club_id, v_door.branch_id,
       array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.mfa_ok(v_door.club_id) then raise exception 'MFA required' using errcode = '42501'; end if;
  v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.doors set secret = v_secret where id = p_door_id;
  perform private.write_audit(v_door.club_id, 'access', 'door_secret_rotate', p_door_id);
  return v_secret;
end;
$$;

create function public.set_door_active(p_door_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_door public.doors%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_door from public.doors where id = p_door_id for update;
  if not found or not private.has_branch_role(v_door.club_id, v_door.branch_id,
       array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.mfa_ok(v_door.club_id) then raise exception 'MFA required' using errcode = '42501'; end if;
  update public.doors set active = p_active where id = p_door_id;
  perform private.write_audit(v_door.club_id, 'access', case when p_active then 'door_enable' else 'door_disable' end, p_door_id);
end;
$$;

-- ===== Member scan =====
create function public.scan_door(p_door_id uuid, p_code text)
returns table (granted boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_door public.doors%rowtype; v_member uuid; v_ms uuid; v_step bigint;
  v_attempt uuid; v_granted boolean := false; v_reason text;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;

  -- throttling: at most 10 scans a minute and 5 denials in 10 minutes per user
  if (select count(*) from public.door_attempts
       where user_id = auth.uid() and created_at > now() - interval '1 minute') >= 10
     or (select count(*) from public.door_attempts
          where user_id = auth.uid() and not granted and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'too many attempts' using errcode = '42501';
  end if;

  select * into v_door from public.doors where id = p_door_id and active;
  if not found then raise exception 'invalid door'; end if;

  select id into v_member from public.members where club_id = v_door.club_id and user_id = auth.uid();
  v_step := floor(extract(epoch from now()) / 30)::bigint;

  if v_member is null then
    v_reason := 'not_a_member';
  elsif p_code is null or p_code not in (private.door_code(v_door.secret, v_step),
                                         private.door_code(v_door.secret, v_step - 1)) then
    v_reason := 'invalid_code';
  else
    v_ms := private.covering_membership(v_door.club_id, v_member, private.club_today(v_door.club_id));
    if v_ms is null then
      v_reason := 'no_active_membership';
    else
      v_granted := true;
      v_reason := 'ok';
    end if;
  end if;

  insert into public.door_attempts (club_id, branch_id, door_id, user_id, member_id, granted, reason)
    values (v_door.club_id, v_door.branch_id, v_door.id, auth.uid(), v_member, v_granted, v_reason)
    returning id into v_attempt;

  if v_granted then
    insert into public.door_commands (club_id, door_id, member_id, attempt_id, expires_at)
      values (v_door.club_id, v_door.id, v_member, v_attempt, now() + interval '15 seconds');
    -- one attendance record per 10 minutes, but the door always opens for a valid member
    if not exists (select 1 from public.checkins
                    where member_id = v_member and checked_in_at > now() - interval '10 minutes') then
      insert into public.checkins (club_id, branch_id, member_id, membership_id, method, checked_in_by)
        values (v_door.club_id, v_door.branch_id, v_member, v_ms, 'door', auth.uid());
    end if;
  end if;
  return query select v_granted, v_reason;
end;
$$;

-- ===== Door integration (service role only): claim the next pending unlock command =====
create function public.door_claim_command(p_door_id uuid)
returns table (command_id uuid, member_id uuid, expires_at timestamptz)
language sql security definer set search_path = '' as $$
  update public.door_commands c set consumed_at = now()
   where c.id = (select d.id from public.door_commands d
                  where d.door_id = p_door_id and d.consumed_at is null and d.expires_at > now()
                  order by d.created_at limit 1 for update skip locked)
  returning c.id, c.member_id, c.expires_at;
$$;

-- ===== Grants =====
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function private.door_code(text, bigint) from authenticated;

revoke execute on function public.create_door(uuid, text) from public, anon;
revoke execute on function public.rotate_door_secret(uuid) from public, anon;
revoke execute on function public.set_door_active(uuid, boolean) from public, anon;
revoke execute on function public.scan_door(uuid, text) from public, anon;
revoke execute on function public.door_claim_command(uuid) from public, anon, authenticated;
grant execute on function public.create_door(uuid, text) to authenticated;
grant execute on function public.rotate_door_secret(uuid) to authenticated;
grant execute on function public.set_door_active(uuid, boolean) to authenticated;
grant execute on function public.scan_door(uuid, text) to authenticated;
grant execute on function public.door_claim_command(uuid) to service_role;
