alter table public.doors add column if not exists lat double precision, add column if not exists lng double precision, add column if not exists radius_m smallint not null default 40;
alter table public.doors add constraint doors_geo_chk check ((lat is null or lat between -90 and 90) and (lng is null or lng between -180 and 180) and radius_m between 10 and 200);
grant select (lat, lng, radius_m) on public.doors to authenticated;
alter table public.door_attempts drop constraint door_attempts_method_check;
alter table public.door_attempts add constraint door_attempts_method_check check (method = any (array['qr','card','pin','app']));

create or replace function public.set_door_location(p_door uuid, p_lat double precision, p_lng double precision, p_radius integer)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.doors%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode='42501'; end if;
  select * into d from public.doors where id = p_door;
  if not found then raise exception 'invalid door'; end if;
  if not private.mfa_ok(d.club_id) or not private.has_branch_role(d.club_id, d.branch_id, array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or (p_lat = 0 and p_lng = 0) then raise exception 'invalid location'; end if;
  if p_radius is null or p_radius not between 10 and 200 then raise exception 'invalid radius'; end if;
  update public.doors set lat = p_lat, lng = p_lng, radius_m = p_radius where id = p_door;
  perform private.write_audit(d.club_id, 'access', 'set_door_location', p_door::text, jsonb_build_object('radius_m', p_radius));
end; $$;

create or replace function public.my_doors()
returns table(id uuid, name text, direction text, branch_id uuid, has_location boolean)
language sql security definer stable set search_path = '' as $$
  select d.id, d.name, d.direction, d.branch_id, (d.lat is not null and d.lng is not null)
    from public.doors d
   where d.active and private.real_user()
     and exists (select 1 from public.members m where m.user_id = auth.uid() and m.club_id = d.club_id)
   order by d.name;
$$;

create or replace function public.open_door_nearby(p_door_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns table(granted boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare v_door public.doors%rowtype; v_member uuid; v_pre text; v_dist double precision;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode='42501'; end if;
  if (select count(*) from public.door_attempts da where da.user_id = auth.uid() and da.created_at > now() - interval '1 minute') >= 10
     or (select count(*) from public.door_attempts da where da.user_id = auth.uid() and not da.granted and da.created_at > now() - interval '10 minutes') >= 8 then
    raise exception 'too many attempts' using errcode='42501';
  end if;
  select * into v_door from public.doors d where d.id = p_door_id and d.active;
  if not found then raise exception 'invalid door'; end if;
  select m.id into v_member from public.members m where m.club_id = v_door.club_id and m.user_id = auth.uid();
  if v_member is null then v_pre := 'not_a_member';
  elsif v_door.lat is null or v_door.lng is null then v_pre := 'no_location';
  elsif p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
        or p_accuracy is null or p_accuracy <= 0 or p_accuracy > 50 then v_pre := 'weak_gps';
  else
    v_dist := 2 * 6371000 * asin(least(1, sqrt(power(sin(radians(p_lat - v_door.lat) / 2), 2)
              + cos(radians(v_door.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_door.lng) / 2), 2))));
    if v_dist > v_door.radius_m then v_pre := 'too_far'; end if;
  end if;
  return query select * from private.process_door_access(v_door, v_member, auth.uid(), 'app', null, v_pre);
end; $$;

revoke all on function public.set_door_location(uuid,double precision,double precision,integer), public.my_doors(), public.open_door_nearby(uuid,double precision,double precision,double precision) from public, anon;
grant execute on function public.set_door_location(uuid,double precision,double precision,integer), public.my_doors(), public.open_door_nearby(uuid,double precision,double precision,double precision) to authenticated;
revoke execute on function public.set_member_pin(text) from authenticated;
