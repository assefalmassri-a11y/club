
create table if not exists private.app_secrets (name text primary key, value text not null, updated_at timestamptz not null default now());
alter table private.app_secrets enable row level security;
revoke all on private.app_secrets from public, anon, authenticated;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, delete on public.push_subscriptions to service_role;
create index on public.push_subscriptions (user_id);

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_endpoint !~ '^https://' then raise exception 'invalid endpoint'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
  delete from public.push_subscriptions where id in (
    select id from public.push_subscriptions where user_id = auth.uid() order by created_at desc offset 10);
end; $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end; $$;

create or replace function public.push_get_config()
returns table(vapid_public text, vapid_private text, hook_secret text)
language sql stable security definer set search_path = '' as $$
  select (select value from private.app_secrets where name = 'vapid_public'),
         (select value from private.app_secrets where name = 'vapid_private'),
         (select value from private.app_secrets where name = 'push_hook_secret');
$$;

revoke all on function public.save_push_subscription(text,text,text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
revoke all on function public.push_get_config() from public, anon, authenticated;
grant execute on function public.save_push_subscription(text,text,text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.push_get_config() to service_role;

create or replace function private.push_send(p_users uuid[], p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_users is null or cardinality(p_users) = 0 then return; end if;
  perform net.http_post(
    url := 'https://ufpqzisiguofxtubuujs.supabase.co/functions/v1/push-notify',
    body := jsonb_build_object('user_ids', to_jsonb(p_users), 'title', p_title, 'body', p_body),
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-push-secret', (select value from private.app_secrets where name = 'push_hook_secret')),
    timeout_milliseconds := 5000);
exception when others then
  null;
end; $$;

create or replace function private.push_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.conversations%rowtype; m public.members%rowtype; ids uuid[];
begin
  select * into c from public.conversations where id = new.conversation_id;
  if not found then return new; end if;
  if c.kind in ('support', 'trainer') then
    select * into m from public.members where id = c.member_id;
    if m.user_id is not null and m.user_id = new.sender_user_id then
      if c.kind = 'support' then
        select coalesce(array_agg(s.user_id), '{}') into ids from public.staff s
         where s.club_id = c.club_id and (s.role = 'owner' or (s.role in ('branch_manager','staff') and s.branch_id = c.branch_id));
      else
        select coalesce(array_agg(s.user_id), '{}') into ids from public.staff s where s.id = c.trainer_staff_id;
      end if;
    else
      ids := case when m.user_id is null then '{}'::uuid[] else array[m.user_id] end;
    end if;
  elsif c.kind = 'staff' then
    select coalesce(array_agg(s.user_id), '{}') into ids from public.staff s
     where s.club_id = c.club_id and (s.role = 'owner' or c.branch_id is null or s.branch_id = c.branch_id);
  else
    select coalesce(array_agg(x.user_id), '{}') into ids from (
      select mm.user_id from public.members mm
       where mm.club_id = c.club_id and mm.user_id is not null and mm.status = 'active'
         and (c.branch_id is null or mm.branch_id = c.branch_id) limit 1000) x;
  end if;
  ids := array_remove(ids, new.sender_user_id);
  perform private.push_send(ids, 'Club', 'لديك رسالة جديدة');
  return new;
exception when others then
  return new;
end; $$;

create or replace function private.push_on_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  select user_id into u from public.members where id = new.member_id;
  if u is not null then perform private.push_send(array[u], 'Club', 'فاتورة جديدة بانتظارك'); end if;
  return new;
exception when others then
  return new;
end; $$;

create or replace function private.push_on_event_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    select coalesce(array_agg(m.user_id), '{}') into ids
      from public.event_registrations r join public.members m on m.id = r.member_id
     where r.event_id = new.id and r.status <> 'cancelled' and m.user_id is not null;
    perform private.push_send(ids, 'Club', 'أُلغيت فعالية سجّلت فيها: ' || left(new.title, 80));
  end if;
  return new;
exception when others then
  return new;
end; $$;

create or replace function private.push_expiring_memberships()
returns void language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  select coalesce(array_agg(distinct m.user_id), '{}') into ids
    from public.memberships ms join public.members m on m.id = ms.member_id
   where ms.status = 'active' and ms.ends_on = (now() at time zone 'utc')::date + 3 and m.user_id is not null;
  perform private.push_send(ids, 'Club', 'اشتراكك ينتهي بعد 3 أيام');
end; $$;
revoke all on function private.push_send(uuid[],text,text) from public, anon, authenticated;
revoke all on function private.push_expiring_memberships() from public, anon, authenticated;
