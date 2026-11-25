
create table public.member_pins (
  member_id uuid primary key references public.members(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  pin_hash text not null,
  failed int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.member_pins enable row level security;
revoke all on public.member_pins from public, anon, authenticated;

create or replace function public.set_member_pin(p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.members%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into m from public.members where user_id = auth.uid() order by created_at limit 1;
  if not found then raise exception 'not a member' using errcode = '42501'; end if;
  if p_pin !~ '^[0-9]{6}$' or p_pin ~ '^(.)\1{5}$' or p_pin in ('123456','654321','012345','123123') then
    raise exception 'weak pin';
  end if;
  insert into public.member_pins (member_id, club_id, pin_hash)
    values (m.id, m.club_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
    on conflict (member_id) do update set pin_hash = excluded.pin_hash, failed = 0, locked_until = null, updated_at = now();
end; $$;

create or replace function public.my_pin_status()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.member_pins p join public.members m on m.id = p.member_id where m.user_id = auth.uid());
$$;

create or replace function public.pin_tap(p_door_id uuid, p_member_no int, p_pin text, p_ts bigint, p_sig text)
returns table(granted boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_door public.doors%rowtype; v_m public.members%rowtype; v_p public.member_pins%rowtype; v_pre text;
  v_now_ms bigint := floor(extract(epoch from now()) * 1000)::bigint;
begin
  select * into v_door from public.doors d where d.id = p_door_id and d.active for update;
  if not found then raise exception 'invalid door'; end if;

  if (select count(*) from public.door_attempts da
       where da.door_id = p_door_id and not da.granted and da.method = 'pin'
         and da.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'door throttled' using errcode = '42501';
  end if;

  if p_sig is distinct from encode(extensions.hmac(
       p_door_id::text || '|pin|' || coalesce(p_member_no, 0)::text || '|' || coalesce(p_pin, '') || '|' || coalesce(p_ts, 0)::text,
       v_door.secret, 'sha256'), 'hex') then
    return query select * from private.process_door_access(v_door, null, null, 'pin', null, 'bad_signature');
    return;
  end if;
  if p_ts is null or abs(v_now_ms - p_ts) > 60000 or p_ts <= v_door.last_tap_ts then
    return query select * from private.process_door_access(v_door, null, null, 'pin', null, 'stale_timestamp');
    return;
  end if;
  update public.doors set last_tap_ts = p_ts where id = p_door_id;

  if p_pin is null or p_pin !~ '^[0-9]{6}$' or p_member_no is null then
    return query select * from private.process_door_access(v_door, null, null, 'pin', null, 'bad_credentials');
    return;
  end if;

  select * into v_m from public.members where club_id = v_door.club_id and member_no = p_member_no;
  if found then
    select * into v_p from public.member_pins where member_id = v_m.id for update;
  end if;
  if v_p.member_id is null then
    v_pre := 'bad_credentials';
  elsif v_p.locked_until is not null and v_p.locked_until > now() then
    v_pre := 'pin_locked';
  elsif v_p.pin_hash = extensions.crypt(p_pin, v_p.pin_hash) then
    update public.member_pins set failed = 0, locked_until = null where member_id = v_p.member_id;
  else
    update public.member_pins
       set failed = case when failed + 1 >= 5 then 0 else failed + 1 end,
           locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' else null end
     where member_id = v_p.member_id;
    v_pre := 'bad_credentials';
  end if;
  return query select * from private.process_door_access(v_door, case when v_pre is null then v_m.id end, null, 'pin', null, v_pre);
end; $$;

revoke all on function public.set_member_pin(text) from public, anon;
revoke all on function public.my_pin_status() from public, anon;
revoke all on function public.pin_tap(uuid,int,text,bigint,text) from public, anon, authenticated;
grant execute on function public.set_member_pin(text) to authenticated;
grant execute on function public.my_pin_status() to authenticated;
grant execute on function public.pin_tap(uuid,int,text,bigint,text) to service_role;
