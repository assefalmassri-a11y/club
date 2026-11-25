insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('equipment-photos','equipment-photos',false,716800,array['image/jpeg']) on conflict(id) do nothing;

alter table public.equipment add column photo_path text check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$');

create or replace function private.equipment_photo_ok(p_name text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c uuid; e uuid; br uuid;
begin
  if not private.real_user() then return false; end if;
  if p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then return false; end if;
  c := split_part(p_name,'/',1)::uuid; e := replace(split_part(p_name,'/',2),'.jpg','')::uuid;
  select branch_id into br from public.equipment where id=e and club_id=c;
  if br is null then return false; end if;
  if p_write then return private.has_branch_role(c,br,array['owner','branch_manager']::public.staff_role[]); end if;
  return private.nontrainer_scope(c,br);
end $$;
revoke all on function private.equipment_photo_ok from public,anon;
grant execute on function private.equipment_photo_ok to authenticated;

create policy equip_photos_read on storage.objects for select to authenticated using (bucket_id='equipment-photos' and private.equipment_photo_ok(name,false));
create policy equip_photos_insert on storage.objects for insert to authenticated with check (bucket_id='equipment-photos' and private.equipment_photo_ok(name,true));
create policy equip_photos_update on storage.objects for update to authenticated using (bucket_id='equipment-photos' and private.equipment_photo_ok(name,true)) with check (bucket_id='equipment-photos' and private.equipment_photo_ok(name,true));
create policy equip_photos_delete on storage.objects for delete to authenticated using (bucket_id='equipment-photos' and private.equipment_photo_ok(name,true));

create or replace function public.set_equipment_photo(p_id uuid,p_path text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.equipment%rowtype;
begin
  select * into e from public.equipment where id=p_id;
  if not found or not (private.real_user() and private.has_branch_role(e.club_id,e.branch_id,array['owner','branch_manager']::public.staff_role[])) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_path is not null and p_path <> e.club_id::text||'/'||e.id::text||'.jpg' then raise exception 'bad_path'; end if;
  update public.equipment set photo_path=p_path where id=p_id;
end $$;
revoke all on function public.set_equipment_photo from public,anon;
grant execute on function public.set_equipment_photo to authenticated;
