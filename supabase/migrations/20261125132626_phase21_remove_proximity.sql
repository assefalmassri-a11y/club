-- Phase 21: remove proximity (GPS) door opening. Entry and exit are by RFID/Mifare/NFC cards only.
drop function if exists public.open_door_nearby(uuid, double precision, double precision, double precision);
drop function if exists public.my_doors();
drop function if exists public.set_door_location(uuid, double precision, double precision, integer);
revoke select (lat, lng, radius_m) on public.doors from authenticated;
alter table public.doors drop constraint if exists doors_geo_chk;
alter table public.doors drop column if exists lat, drop column if exists lng, drop column if exists radius_m;
alter table public.door_attempts drop constraint if exists door_attempts_method_check;
alter table public.door_attempts add constraint door_attempts_method_check check (method = any (array['qr','card','pin']));
