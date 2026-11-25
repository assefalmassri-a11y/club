create extension if not exists pg_cron;
select cron.schedule('chat-retention-21d', '17 3 * * *', $c$select private.purge_old_chat(21)$c$);
do $f$ begin
  alter publication supabase_realtime add table public.messages;
exception when others then null;
end $f$;
