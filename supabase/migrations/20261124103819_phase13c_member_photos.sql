insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('member-photos','member-photos',false,524288,array['image/jpeg']) on conflict(id) do nothing;

create or replace function private.photo_object_ok(p_name text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c uuid; m uuid; br uuid;
begin
  if not private.real_user() then return false; end if;
  if p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then return false; end if;
  c := split_part(p_name,'/',1)::uuid;
  m := replace(split_part(p_name,'/',2),'.jpg','')::uuid;
  select branch_id into br from public.members where id=m and club_id=c;
  if br is null then return false; end if;
  if private.has_branch_role(c,br,array['owner','branch_manager','staff']::public.staff_role[]) then return true; end if;
  if not p_write and private.is_own_member(c,m) then return true; end if;
  return false;
end $$;
revoke all on function private.photo_object_ok from public,anon;
grant execute on function private.photo_object_ok to authenticated;

create policy member_photos_read on storage.objects for select to authenticated
  using (bucket_id='member-photos' and private.photo_object_ok(name,false));
create policy member_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id='member-photos' and private.photo_object_ok(name,true));
create policy member_photos_update on storage.objects for update to authenticated
  using (bucket_id='member-photos' and private.photo_object_ok(name,true))
  with check (bucket_id='member-photos' and private.photo_object_ok(name,true));
create policy member_photos_delete on storage.objects for delete to authenticated
  using (bucket_id='member-photos' and private.photo_object_ok(name,true));

alter table public.members add column photo_path text check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$');
