create extension if not exists pg_net;

create or replace function private.purge_old_chat(p_days integer default 21) returns bigint
language plpgsql security definer set search_path = '' as $f$
declare n bigint;
begin
  if p_days < 1 then raise exception 'invalid retention'; end if;
  perform set_config('app.chat_purge', '1', true);
  insert into public.chat_purge_queue (path)
    select image_path from public.messages
    where created_at < now() - make_interval(days => p_days) and image_path is not null
  on conflict do nothing;
  -- uploaded images that never got attached to a message
  insert into public.chat_purge_queue (path)
    select o.name from storage.objects o
    where o.bucket_id = 'chat-images'
      and o.created_at < now() - make_interval(days => p_days)
      and not exists (select 1 from public.messages m where m.image_path = o.name)
  on conflict do nothing;
  delete from public.messages where created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  perform set_config('app.chat_purge', '0', true);
  return n;
end $f$;

select cron.schedule('chat-cleanup-files', '37 3 * * *', $c$
  select net.http_post(
    url := 'https://ufpqzisiguofxtubuujs.supabase.co/functions/v1/chat-cleanup',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb)
$c$);
