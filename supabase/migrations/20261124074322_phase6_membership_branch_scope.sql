
alter table public.memberships add column valid_branch_id uuid;
alter table public.memberships add constraint memberships_valid_branch_fk
  foreign key (valid_branch_id, club_id) references public.branches(id, club_id);

-- The scope always comes from the plan (clients cannot choose it).
create or replace function private.membership_scope_biu()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select p.branch_id into new.valid_branch_id
    from public.membership_plans p where p.id = new.plan_id and p.club_id = new.club_id;
  return new;
end; $$;
create trigger membership_scope_bi before insert on public.memberships
  for each row execute function private.membership_scope_biu();

create or replace function private.membership_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'memberships cannot be deleted; cancel them instead' using errcode = '42501';
  end if;
  if new.club_id <> old.club_id or new.member_id <> old.member_id or new.plan_id <> old.plan_id
     or new.price_cents <> old.price_cents or new.currency <> old.currency
     or new.valid_branch_id is distinct from old.valid_branch_id then
    raise exception 'membership plan, member, price and branch scope are immutable' using errcode = '42501';
  end if;
  return new;
end; $$;

-- Branch-aware coverage (null scope = valid in every branch).
create or replace function private.covering_membership(c uuid, m uuid, d date, b uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select ms.id
  from public.memberships ms
  join public.members mem on mem.id = ms.member_id and mem.club_id = ms.club_id
  where ms.club_id = c and ms.member_id = m and ms.status = 'active' and mem.status = 'active'
    and d between ms.starts_on and ms.ends_on
    and (ms.valid_branch_id is null or ms.valid_branch_id = b)
  order by ms.ends_on desc limit 1;
$$;

create or replace function private.do_checkin(p_club uuid, p_branch uuid, p_member uuid, p_method checkin_method)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ms uuid; v_id uuid;
begin
  v_ms := private.covering_membership(p_club, p_member, private.club_today(p_club), p_branch);
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
end; $$;

create or replace function private.process_door_access(p_door doors, p_member uuid, p_user uuid, p_method text, p_card uuid, p_pre_reason text default null)
returns table(granted boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare v_ms uuid; v_visit uuid; v_ok boolean := false; v_why text; v_attempt uuid;
begin
  if p_pre_reason is not null then
    v_why := p_pre_reason;
  else
    select c.id into v_visit from public.checkins c
     where c.member_id = p_member and c.branch_id = p_door.branch_id
       and c.checked_in_at > now() - interval '6 hours'
       and not exists (select 1 from public.checkouts o where o.checkin_id = c.id)
     order by c.checked_in_at desc limit 1;

    if p_door.direction = 'entry' then
      v_ms := private.covering_membership(p_door.club_id, p_member, private.club_today(p_door.club_id), p_door.branch_id);
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
end; $$;

create or replace function public.register_for_event(p_event_id uuid, p_member_id uuid default null)
returns registration_status language plpgsql security definer set search_path = '' as $$
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
       (v_ev.starts_at at time zone private.club_tz(v_ev.club_id))::date, v_ev.branch_id) is null then
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
end; $$;
