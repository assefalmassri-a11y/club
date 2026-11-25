alter table public.door_attempts drop constraint door_attempts_method_check;
alter table public.door_attempts add constraint door_attempts_method_check check (method = any (array['qr','card','pin']));
