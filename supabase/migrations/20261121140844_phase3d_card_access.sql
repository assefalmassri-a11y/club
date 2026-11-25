-- Card (RFID/NFC) access: the reader signs each tap with the door secret; only the service role can submit taps.

-- Per-club key used to hash card UIDs (never exposed to clients)
create table private.club_secrets (
  club_id uuid primary key references public.clubs(id) on delete restrict,
  card_key text not null
);
alter table private.club_secrets enable row level security;
revoke all on private.club_secrets from public, anon, authenticated;

create function private.card_hash(p_club uuid, p_uid text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  select s.card_key into v_key from private.club_secrets s where s.club_id = p_club;
  if v_key is null then
    insert into private.club_secrets (club_id, card_key)
      values (p_club, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
      on conflict (club_id) do nothing;
    select s.card_key into v_key from private.club_secrets s where s.club_id = p_club;
  end if;
  return encode(extensions.hmac(p_uid, v_key, 'sha256'), 'hex');
end;
$$;

create type public.card_status as enum ('active','revoked');

create table public.access_cards (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  member_id uuid not null,
  card_hash text not null,                  -- HMAC of the card UID; the UID itself is never stored
  uid_suffix text not null,                 -- last 4 characters, to recognise the card
  label text check (char_length(label) <= 60),
  status public.card_status not null default 'active',
  issued_by uuid,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  revoked_by uuid,
  check (status <> 'revoked' or (revoked_at is not null and revoked_reason is not null)),
  unique (id, club_id),
  foreign key (member_id, club_id) references public.members(id, club_id)
);
create unique index access_cards_one_active_hash on public.access_cards (club_id, card_hash) where status = 'active';
create index on public.access_cards (member_id);

create function private.card_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'cards cannot be deleted; revoke them instead' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'status' - 'revoked_at' - 'revoked_reason' - 'revoked_by')
       is distinct from (to_jsonb(old) - 'status' - 'revoked_at' - 'revoked_reason' - 'revoked_by') then
    raise exception 'card fields are immutable' using errcode = '42501';
  end if;
  if old.status = 'revoked' then
    raise exception 'a revoked card cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger card_guard_bud before update or delete on public.access_cards
  for each row execute function private.card_guard();
create trigger card_no_truncate before truncate on public.access_cards
  for each statement execute function private.deny_change();

alter table public.access_cards enable row level security;
revoke all on public.access_cards from anon, authenticated;
grant select (id, club_id, member_id, uid_suffix, label, status, issued_at, revoked_at, revoked_reason)
  on public.access_cards to authenticated;   -- never the hash

create policy no_anonymous on public.access_cards as restrictive for all to authenticated using (private.real_user());
create policy cards_staff_read on public.access_cards for select to authenticated
  using (exists (select 1 from public.members m
                  where m.id = access_cards.member_id and m.club_id = access_cards.club_id
                    and private.can_access_branch(m.club_id, m.branch_id)));
create policy cards_self_read on public.access_cards for select to authenticated
  using (private.is_own_member(club_id, member_id));

-- Door attempts: record how the door was opened
alter table public.door_attempts add column method text not null default 'qr' check (method in ('qr','card'));
alter table public.door_attempts add column card_id uuid references public.access_cards(id);
-- Replay protection for reader messages (milliseconds, strictly increasing per door)
alter table public.doors add column last_tap_ts bigint not null default 0;

-- Shared decision/apply logic for every way of opening a door
create function private.process_door_access(
  p_door public.doors, p_member uuid, p_user uuid, p_method text, p_card uuid,
  p_pre_reason text default null
) returns table (granted boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare v_ms uuid; v_visit uuid; v_ok boolean := false; v_why text; v_attempt uuid;
begin
  if p_pre_reason is not null then
    v_why := p_pre_reason;
  else
    -- latest open visit at this branch (not checked out, within 6 hours)
    select c.id into v_visit from public.checkins c
     where c.member_id = p_member and c.branch_id = p_door.branch_id
       and c.checked_in_at > now() - interval '6 hours'
       and not exists (select 1 from public.checkouts o where o.checkin_id = c.id)
     order by c.checked_in_at desc limit 1;

    if p_door.direction = 'entry' then
      v_ms := private.covering_membership(p_door.club_id, p_member, private.club_today(p_door.club_id));
      if v_ms is null then
        v_why := 'no_active_membership';
      else
        v_ok := true; v_why := 'ok';
      end if;
    else
      v_ok := true;
      v_why := case when v_visit is null then 'ok_no_open_visit' else 'ok' end;
    end if;
  end if;

  insert into public.door_attempts (club_id, branch_id, door_id, user_id, member_id, granted, reason, direction, method, card_id)
    values (p_door.club_id, p_door.branch_id, p_door.id, p_user, p_member, v_ok, v_why, p_door.direction, p_method, p_card)
    returning id into v_attempt;

  if v_ok then
    insert into public.door_commands (club_id, door_id, member_id, attempt_id, expires_at)
      values (p_door.club_id, p_door.id, p_member, v_attempt, now() + interval '15 seconds');
    if p_door.direction = 'entry' then
      if v_visit is null then
        insert into public.checkins (club_id, branch_id, member_id, membership_id, method, checked_in_by)
          values (p_door.club_id, p_door.branch_id, p_member, v_ms, 'door', p_user);
      end if;
    elsif v_visit is not null then
      insert into public.checkouts (club_id, branch_id, member_id, checkin_id, door_id)
        values (p_door.club_id, p_door.branch_id, p_member, v_visit, p_door.id);
    end if;
  end if;
  return query select v_ok, v_why;
end;
$$;

-- QR scan now delegates to the shared logic
create or replace function public.scan_door(p_door_id uuid, p_code text)
returns table (granted boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_door public.doors%rowtype; v_member uuid; v_step bigint; v_pre text;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;

  if (select count(*) from public.door_attempts da
       where da.user_id = auth.uid() and da.created_at > now() - interval '1 minute') >= 10
     or (select count(*) from public.door_attempts da
          where da.user_id = auth.uid() and not da.granted and da.created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'too many attempts' using errcode = '42501';
  end if;

  select * into v_door from public.doors d where d.id = p_door_id and d.active;
  if not found then raise exception 'invalid door'; end if;

  select m.id into v_member from public.members m
   where m.club_id = v_door.club_id and m.user_id = auth.uid();
  v_step := floor(extract(epoch from now()) / 30)::bigint;

  if v_member is null then
    v_pre := 'not_a_member';
  elsif p_code is null or p_code not in (private.door_code(v_door.secret, v_step),
                                         private.door_code(v_door.secret, v_step - 1)) then
    v_pre := 'invalid_code';
  end if;
  return query select * from private.process_door_access(v_door, v_member, auth.uid(), 'qr', null, v_pre);
end;
$$;

-- Card tap (service role only). Signature = hex HMAC-SHA256(key = door secret,
-- message = door_id || '|' || card UID (upper-case hex) || '|' || timestamp in ms).
create function public.card_tap(p_door_id uuid, p_card_uid text, p_ts bigint, p_sig text)
returns table (granted boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_door public.doors%rowtype; v_uid text; v_card public.access_cards%rowtype; v_pre text;
  v_now_ms bigint := floor(extract(epoch from now()) * 1000)::bigint;
begin
  select * into v_door from public.doors d where d.id = p_door_id and d.active for update;
  if not found then raise exception 'invalid door'; end if;

  if (select count(*) from public.door_attempts da
       where da.door_id = p_door_id and not da.granted and da.method = 'card'
         and da.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'door throttled' using errcode = '42501';
  end if;

  v_uid := upper(regexp_replace(coalesce(p_card_uid, ''), '[^0-9A-Fa-f]', '', 'g'));

  if p_sig is distinct from encode(extensions.hmac(
       p_door_id::text || '|' || v_uid || '|' || coalesce(p_ts, 0)::text, v_door.secret, 'sha256'), 'hex') then
    return query select * from private.process_door_access(v_door, null, null, 'card', null, 'bad_signature');
    return;
  end if;
  if p_ts is null or abs(v_now_ms - p_ts) > 60000 or p_ts <= v_door.last_tap_ts then
    return query select * from private.process_door_access(v_door, null, null, 'card', null, 'stale_timestamp');
    return;
  end if;
  update public.doors set last_tap_ts = p_ts where id = p_door_id;

  if char_length(v_uid) < 8 then
    return query select * from private.process_door_access(v_door, null, null, 'card', null, 'unknown_card');
    return;
  end if;
  select * into v_card from public.access_cards c
   where c.club_id = v_door.club_id and c.card_hash = private.card_hash(v_door.club_id, v_uid)
   order by (c.status = 'active') desc, c.issued_at desc limit 1;
  if not found then
    v_pre := 'unknown_card';
  elsif v_card.status <> 'active' then
    v_pre := 'card_revoked';
  end if;
  return query select * from private.process_door_access(v_door, v_card.member_id, null, 'card', v_card.id, v_pre);
end;
$$;

-- Card administration (owner, branch manager, front-desk staff of the member's branch)
create function public.issue_card(p_member_id uuid, p_card_uid text, p_label text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_m public.members%rowtype; v_uid text; v_id uuid;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_m from public.members m where m.id = p_member_id;
  if not found or not private.has_branch_role(v_m.club_id, v_m.branch_id,
       array['owner','branch_manager','staff']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_m.status <> 'active' then raise exception 'member is not active'; end if;
  v_uid := upper(regexp_replace(coalesce(p_card_uid, ''), '[^0-9A-Fa-f]', '', 'g'));
  if char_length(v_uid) not between 8 and 20 then raise exception 'invalid card UID'; end if;
  if (select count(*) from public.access_cards c
       where c.member_id = p_member_id and c.status = 'active') >= 3 then
    raise exception 'a member can hold at most 3 active cards';
  end if;
  if exists (select 1 from public.access_cards c
              where c.club_id = v_m.club_id and c.card_hash = private.card_hash(v_m.club_id, v_uid)
                and c.status = 'active') then
    raise exception 'this card is already assigned';
  end if;
  insert into public.access_cards (club_id, member_id, card_hash, uid_suffix, label, issued_by)
    values (v_m.club_id, p_member_id, private.card_hash(v_m.club_id, v_uid), right(v_uid, 4),
            nullif(trim(coalesce(p_label, '')), ''), auth.uid())
    returning id into v_id;
  perform private.write_audit(v_m.club_id, 'access', 'card_issue', v_id,
    jsonb_build_object('member_id', p_member_id, 'uid_suffix', right(v_uid, 4)));
  return v_id;
end;
$$;

create function public.revoke_card(p_card_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_c public.access_cards%rowtype; v_m public.members%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_c from public.access_cards c where c.id = p_card_id for update;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_m from public.members m where m.id = v_c.member_id;
  if not private.has_branch_role(v_m.club_id, v_m.branch_id,
       array['owner','branch_manager','staff']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_c.status <> 'active' then raise exception 'card is already revoked'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 160 then
    raise exception 'a reason (1-160 characters) is required';
  end if;
  update public.access_cards
     set status = 'revoked', revoked_at = now(), revoked_reason = trim(p_reason), revoked_by = auth.uid()
   where id = p_card_id;
  perform private.write_audit(v_c.club_id, 'access', 'card_revoke', p_card_id,
    jsonb_build_object('member_id', v_c.member_id, 'reason', trim(p_reason)));
end;
$$;

-- Grants
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function private.door_code(text, bigint) from authenticated;
revoke execute on function private.card_hash(uuid, text) from authenticated;
revoke execute on function private.process_door_access(public.doors, uuid, uuid, text, uuid, text) from authenticated;

revoke execute on function public.scan_door(uuid, text) from public, anon;
grant execute on function public.scan_door(uuid, text) to authenticated;
revoke execute on function public.card_tap(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.card_tap(uuid, text, bigint, text) to service_role;
revoke execute on function public.issue_card(uuid, text, text) from public, anon;
revoke execute on function public.revoke_card(uuid, text) from public, anon;
grant execute on function public.issue_card(uuid, text, text) to authenticated;
grant execute on function public.revoke_card(uuid, text) to authenticated;
