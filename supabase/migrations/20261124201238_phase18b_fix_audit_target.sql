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
  perform private.write_audit(d.club_id, 'access', 'set_door_location', p_door, jsonb_build_object('radius_m', p_radius));
end; $$;
