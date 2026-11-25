-- Door direction: each door device is an entry door or an exit door
alter table public.doors add column direction text not null default 'entry' check (direction in ('entry','exit'));
alter table public.door_attempts add column direction text not null default 'entry' check (direction in ('entry','exit'));
grant select (direction) on public.doors to authenticated;

alter table public.checkins add unique (id, club_id);

-- One checkout per visit (append-only)
create table public.checkouts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  branch_id uuid not null,
  member_id uuid not null,
  checkin_id uuid not null unique,
  door_id uuid,
  checked_out_at timestamptz not null default now(),
  foreign key (checkin_id, club_id) references public.checkins(id, club_id),
  foreign key (member_id, club_id) references public.members(id, club_id),
  foreign key (branch_id, club_id) references public.branches(id, club_id),
  foreign key (door_id, club_id) references public.doors(id, club_id)
);
create index on public.checkouts (club_id, branch_id, checked_out_at desc);

create trigger checkouts_no_change before update or delete on public.checkouts
  for each row execute function private.deny_change();
create trigger checkouts_no_truncate before truncate on public.checkouts
  for each statement execute function private.deny_change();

alter table public.checkouts enable row level security;
revoke all on public.checkouts from anon;
revoke insert, update, delete, truncate, references, trigger on public.checkouts from authenticated;
create policy no_anonymous on public.checkouts as restrictive for all to authenticated using (private.real_user());
create policy checkouts_staff_read on public.checkouts for select to authenticated
  using (private.can_access_branch(club_id, branch_id));
create policy checkouts_self_read on public.checkouts for select to authenticated
  using (private.is_own_member(club_id, member_id));

-- Who is inside now: latest visit per member and branch, not checked out, within the last 6 hours
create view public.members_inside with (security_invoker = true) as
select c.club_id, c.branch_id, c.member_id, c.id as checkin_id, c.checked_in_at
from public.checkins c
where c.checked_in_at > now() - interval '6 hours'
  and not exists (select 1 from public.checkouts o where o.checkin_id = c.id)
  and c.checked_in_at = (select max(c2.checked_in_at) from public.checkins c2
                          where c2.member_id = c.member_id and c2.branch_id = c.branch_id);
revoke all on public.members_inside from anon;
revoke insert, update, delete, truncate, references, trigger on public.members_inside from authenticated;

-- Door creation with an explicit direction; the 2-argument form keeps creating entry doors
create function public.create_door(p_branch_id uuid, p_name text, p_direction text)
returns table (door_id uuid, secret text)
language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_id uuid; v_secret text;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_direction not in ('entry','exit') then raise exception 'direction must be entry or exit'; end if;
  select b.club_id into v_club from public.branches b where b.id = p_branch_id;
  if v_club is null or not private.has_branch_role(v_club, p_branch_id,
       array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.mfa_ok(v_club) then raise exception 'MFA required' using errcode = '42501'; end if;
  v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.doors (club_id, branch_id, name, direction, secret)
    values (v_club, p_branch_id, trim(p_name), p_direction, v_secret) returning id into v_id;
  perform private.write_audit(v_club, 'access', 'door_create', v_id,
    jsonb_build_object('branch_id', p_branch_id, 'direction', p_direction));
  return query select v_id, v_secret;
end;
$$;

create or replace function public.create_door(p_branch_id uuid, p_name text)
returns table (door_id uuid, secret text)
language plpgsql security definer set search_path = '' as $$
begin
  return query select d.door_id, d.secret from public.create_door(p_branch_id, p_name, 'entry') d;
end;
$$;

-- Scan: entry doors require an active membership; exit doors let any club member out and record the checkout
create or replace function public.scan_door(p_door_id uuid, p_code text)
returns table (granted boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_door public.doors%rowtype; v_member uuid; v_ms uuid; v_step bigint; v_attempt uuid;
  v_ok boolean := false; v_why text; v_visit uuid;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;

  -- throttling: at most 10 scans a minute and 5 denials in 10 minutes per user
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
    v_why := 'not_a_member';
  elsif p_code is null or p_code not in (private.door_code(v_door.secret, v_step),
                                         private.door_code(v_door.secret, v_step - 1)) then
    v_why := 'invalid_code';
  else
    -- latest open visit at this branch (not checked out, within 6 hours)
    select c.id into v_visit from public.checkins c
     where c.member_id = v_member and c.branch_id = v_door.branch_id
       and c.checked_in_at > now() - interval '6 hours'
       and not exists (select 1 from public.checkouts o where o.checkin_id = c.id)
     order by c.checked_in_at desc limit 1;

    if v_door.direction = 'entry' then
      v_ms := private.covering_membership(v_door.club_id, v_member, private.club_today(v_door.club_id));
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

  insert into public.door_attempts (club_id, branch_id, door_id, user_id, member_id, granted, reason, direction)
    values (v_door.club_id, v_door.branch_id, v_door.id, auth.uid(), v_member, v_ok, v_why, v_door.direction)
    returning id into v_attempt;

  if v_ok then
    insert into public.door_commands (club_id, door_id, member_id, attempt_id, expires_at)
      values (v_door.club_id, v_door.id, v_member, v_attempt, now() + interval '15 seconds');
    if v_door.direction = 'entry' then
      if v_visit is null then
        insert into public.checkins (club_id, branch_id, member_id, membership_id, method, checked_in_by)
          values (v_door.club_id, v_door.branch_id, v_member, v_ms, 'door', auth.uid());
      end if;
    elsif v_visit is not null then
      insert into public.checkouts (club_id, branch_id, member_id, checkin_id, door_id)
        values (v_door.club_id, v_door.branch_id, v_member, v_visit, v_door.id);
    end if;
  end if;
  return query select v_ok, v_why;
end;
$$;

-- Grants
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function private.door_code(text, bigint) from authenticated;
revoke execute on function public.create_door(uuid, text, text) from public, anon;
grant execute on function public.create_door(uuid, text, text) to authenticated;
revoke execute on function public.create_door(uuid, text) from public, anon;
grant execute on function public.create_door(uuid, text) to authenticated;
revoke execute on function public.scan_door(uuid, text) from public, anon;
grant execute on function public.scan_door(uuid, text) to authenticated;
