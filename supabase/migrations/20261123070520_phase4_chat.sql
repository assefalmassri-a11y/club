create type public.conversation_kind as enum ('support','trainer','staff','announcement');

create table public.trainer_assignments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  branch_id uuid not null,
  member_id uuid not null,
  trainer_staff_id uuid not null,
  assigned_by uuid not null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid,
  unique (id, club_id),
  foreign key (branch_id, club_id) references public.branches(id, club_id),
  foreign key (member_id, club_id) references public.members(id, club_id),
  foreign key (trainer_staff_id, club_id) references public.staff(id, club_id),
  check ((ended_at is null) = (ended_by is null))
);
create unique index trainer_assignments_active_uq on public.trainer_assignments (member_id, trainer_staff_id) where ended_at is null;
create index trainer_assignments_club_idx on public.trainer_assignments (club_id, branch_id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  branch_id uuid,
  kind public.conversation_kind not null,
  member_id uuid,
  trainer_staff_id uuid,
  title text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (id, club_id),
  foreign key (branch_id, club_id) references public.branches(id, club_id),
  foreign key (member_id, club_id) references public.members(id, club_id),
  foreign key (trainer_staff_id, club_id) references public.staff(id, club_id),
  check (title is null or char_length(title) between 1 and 80),
  check (case kind
    when 'support' then member_id is not null and trainer_staff_id is null and branch_id is not null
    when 'trainer' then member_id is not null and trainer_staff_id is not null and branch_id is not null
    else member_id is null and trainer_staff_id is null and title is not null end)
);
create unique index conversations_support_uq on public.conversations (member_id) where kind = 'support';
create unique index conversations_trainer_uq on public.conversations (member_id, trainer_staff_id) where kind = 'trainer';
create unique index conversations_announcement_uq on public.conversations (club_id, (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))) where kind = 'announcement';
create index conversations_club_idx on public.conversations (club_id, kind);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  conversation_id uuid not null,
  sender_user_id uuid not null,
  sender_role text not null check (sender_role in ('member','owner','branch_manager','trainer','staff')),
  sender_name text,
  body text,
  image_path text,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, club_id) references public.conversations(id, club_id),
  check (body is not null or image_path is not null),
  check (body is null or char_length(body) between 1 and 4000)
);
create index messages_conv_idx on public.messages (conversation_id, created_at desc);
create index messages_created_idx on public.messages (created_at);

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations(id),
  user_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.chat_purge_queue (
  path text primary key,
  queued_at timestamptz not null default now()
);

create function private.safe_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $f$
begin return p::uuid; exception when others then return null; end $f$;

create function private.staff_in_scope(p_club uuid, p_branch uuid, p_roles public.staff_role[]) returns boolean
language sql stable security definer set search_path = '' as $f$
  select exists (
    select 1 from public.staff s
    where s.club_id = p_club and s.user_id = (select auth.uid())
      and s.role = any (p_roles)
      and (s.role = 'owner' or p_branch is null or s.branch_id = p_branch));
$f$;

create function private.conv_access(p_conv uuid, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $f$
declare
  c public.conversations;
  uid uuid := (select auth.uid());
  is_member boolean := false;
  staff_side boolean := false;
  ok boolean := false;
begin
  if uid is null then return false; end if;
  select * into c from public.conversations where id = p_conv;
  if not found then return false; end if;

  if c.kind = 'support' then
    is_member := private.is_own_member(c.club_id, c.member_id);
    staff_side := private.staff_in_scope(c.club_id, c.branch_id, array['owner','branch_manager','staff']::public.staff_role[]);
    ok := is_member or staff_side;
    if ok and p_write and is_member and not staff_side then
      ok := exists (select 1 from public.members m where m.id = c.member_id and m.club_id = c.club_id and m.status <> 'cancelled');
    end if;

  elsif c.kind = 'trainer' then
    is_member := private.is_own_member(c.club_id, c.member_id);
    staff_side := exists (select 1 from public.staff s where s.id = c.trainer_staff_id and s.club_id = c.club_id and s.user_id = uid);
    ok := is_member or staff_side;
    if ok and p_write then
      ok := exists (select 1 from public.trainer_assignments a
                    where a.club_id = c.club_id and a.member_id = c.member_id
                      and a.trainer_staff_id = c.trainer_staff_id and a.ended_at is null);
      if ok and is_member then
        ok := exists (select 1 from public.members m where m.id = c.member_id and m.club_id = c.club_id and m.status <> 'cancelled');
      end if;
    end if;

  elsif c.kind = 'staff' then
    ok := private.staff_in_scope(c.club_id, c.branch_id, array['owner','branch_manager','trainer','staff']::public.staff_role[]);

  else
    if p_write then
      if c.branch_id is null then
        ok := private.staff_in_scope(c.club_id, null, array['owner']::public.staff_role[]);
      else
        ok := exists (select 1 from public.staff s where s.club_id = c.club_id and s.user_id = uid
                      and (s.role = 'owner' or (s.role = 'branch_manager' and s.branch_id = c.branch_id)));
      end if;
    else
      ok := private.staff_in_scope(c.club_id, c.branch_id, array['owner','branch_manager','trainer','staff']::public.staff_role[]);
      if not ok then
        ok := exists (select 1 from public.members m
                      where m.club_id = c.club_id and m.user_id = uid and m.status <> 'cancelled'
                        and (c.branch_id is null or m.branch_id = c.branch_id));
      end if;
    end if;
  end if;
  return coalesce(ok, false);
end $f$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create function private.chat_object_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $f$
declare parts text[] := string_to_array(p_name, '/'); conv uuid;
begin
  if array_length(parts, 1) is distinct from 3 then return false; end if;
  conv := private.safe_uuid(parts[2]);
  if conv is null then return false; end if;
  if not exists (select 1 from public.conversations c where c.id = conv and c.club_id::text = parts[1]) then return false; end if;
  return private.conv_access(conv, p_write);
end $f$;

create policy chat_images_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-images' and private.chat_object_ok(name, false));
create policy chat_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and private.chat_object_ok(name, true));
create policy chat_images_no_anonymous on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'chat-images' or private.real_user())
  with check (bucket_id <> 'chat-images' or private.real_user());

create function private.chat_message_guard() returns trigger
language plpgsql set search_path = '' as $f$
begin
  if tg_op = 'DELETE' and current_setting('app.chat_purge', true) = '1' then return old; end if;
  raise exception '% on % is not allowed (append-only)', tg_op, tg_table_name using errcode = '42501';
end $f$;
create trigger messages_immutable before update or delete on public.messages
  for each row execute function private.chat_message_guard();

create function private.purge_old_chat(p_days integer default 21) returns bigint
language plpgsql security definer set search_path = '' as $f$
declare n bigint;
begin
  if p_days < 1 then raise exception 'invalid retention'; end if;
  perform set_config('app.chat_purge', '1', true);
  insert into public.chat_purge_queue (path)
    select image_path from public.messages
    where created_at < now() - make_interval(days => p_days) and image_path is not null
  on conflict do nothing;
  delete from public.messages where created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  perform set_config('app.chat_purge', '0', true);
  return n;
end $f$;

alter table public.trainer_assignments enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;
alter table public.chat_purge_queue enable row level security;

create policy no_anonymous on public.trainer_assignments as restrictive for all to authenticated using (private.real_user());
create policy no_anonymous on public.conversations as restrictive for all to authenticated using (private.real_user());
create policy no_anonymous on public.messages as restrictive for all to authenticated using (private.real_user());
create policy no_anonymous on public.conversation_reads as restrictive for all to authenticated using (private.real_user());

create policy assignments_read on public.trainer_assignments for select to authenticated
  using (private.is_own_member(club_id, member_id)
         or private.staff_in_scope(club_id, branch_id, array['owner','branch_manager','staff']::public.staff_role[])
         or exists (select 1 from public.staff s where s.id = trainer_staff_id and s.club_id = trainer_assignments.club_id and s.user_id = (select auth.uid())));
create policy conversations_read on public.conversations for select to authenticated
  using (private.conv_access(id, false));
create policy messages_read on public.messages for select to authenticated
  using (private.conv_access(conversation_id, false));
create policy reads_own on public.conversation_reads for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.trainer_assignments, public.conversations, public.messages, public.conversation_reads, public.chat_purge_queue from public, anon, authenticated;
grant select on public.trainer_assignments, public.conversations, public.messages, public.conversation_reads to authenticated;
grant select, delete on public.chat_purge_queue to service_role;

revoke execute on function private.safe_uuid(text), private.staff_in_scope(uuid, uuid, public.staff_role[]),
  private.conv_access(uuid, boolean), private.chat_object_ok(text, boolean), private.purge_old_chat(integer) from public, anon, authenticated;
grant execute on function private.safe_uuid(text), private.staff_in_scope(uuid, uuid, public.staff_role[]),
  private.conv_access(uuid, boolean), private.chat_object_ok(text, boolean) to authenticated;

create function public.open_support_conversation(p_member uuid) returns uuid
language plpgsql security definer set search_path = '' as $f$
declare m public.members; v uuid;
begin
  if not private.real_user() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into m from public.members where id = p_member;
  if not found then raise exception 'member not found'; end if;
  if not (private.is_own_member(m.club_id, m.id)
          or private.staff_in_scope(m.club_id, m.branch_id, array['owner','branch_manager','staff']::public.staff_role[])) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if m.status = 'cancelled' then raise exception 'member is cancelled' using errcode = '42501'; end if;
  insert into public.conversations (club_id, branch_id, kind, member_id, created_by)
    values (m.club_id, m.branch_id, 'support', m.id, (select auth.uid()))
    on conflict (member_id) where kind = 'support' do nothing returning id into v;
  if v is null then select id into v from public.conversations where member_id = m.id and kind = 'support'; end if;
  return v;
end $f$;

create function public.assign_trainer(p_member uuid, p_trainer_staff uuid) returns uuid
language plpgsql security definer set search_path = '' as $f$
declare m public.members; t public.staff; a uuid;
begin
  if not private.real_user() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into m from public.members where id = p_member;
  if not found then raise exception 'member not found'; end if;
  if not private.staff_in_scope(m.club_id, m.branch_id, array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.mfa_ok(m.club_id) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into t from public.staff where id = p_trainer_staff and club_id = m.club_id and role = 'trainer'
    and (branch_id is null or branch_id = m.branch_id);
  if not found then raise exception 'invalid trainer'; end if;
  if exists (select 1 from public.trainer_assignments where member_id = m.id and trainer_staff_id = t.id and ended_at is null) then
    raise exception 'already assigned';
  end if;
  insert into public.trainer_assignments (club_id, branch_id, member_id, trainer_staff_id, assigned_by)
    values (m.club_id, m.branch_id, m.id, t.id, (select auth.uid())) returning id into a;
  insert into public.conversations (club_id, branch_id, kind, member_id, trainer_staff_id, created_by)
    values (m.club_id, m.branch_id, 'trainer', m.id, t.id, (select auth.uid()))
    on conflict (member_id, trainer_staff_id) where kind = 'trainer' do nothing;
  perform private.write_audit(m.club_id, 'access', 'trainer_assigned', a, jsonb_build_object('member_id', m.id, 'trainer_staff_id', t.id));
  return a;
end $f$;

create function public.end_trainer_assignment(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $f$
declare a public.trainer_assignments;
begin
  if not private.real_user() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from public.trainer_assignments where id = p_assignment and ended_at is null;
  if not found then raise exception 'assignment not found'; end if;
  if not private.staff_in_scope(a.club_id, a.branch_id, array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.mfa_ok(a.club_id) then raise exception 'MFA required' using errcode = '42501'; end if;
  update public.trainer_assignments set ended_at = now(), ended_by = (select auth.uid()) where id = a.id;
  perform private.write_audit(a.club_id, 'access', 'trainer_unassigned', a.id, jsonb_build_object('member_id', a.member_id, 'trainer_staff_id', a.trainer_staff_id));
end $f$;

create function public.create_staff_channel(p_club uuid, p_branch uuid, p_title text) returns uuid
language plpgsql security definer set search_path = '' as $f$
declare v uuid; v_title text := nullif(btrim(p_title), '');
begin
  if not private.real_user() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_title is null or char_length(v_title) > 80 then raise exception 'invalid title'; end if;
  if p_branch is null then
    if not private.staff_in_scope(p_club, null, array['owner']::public.staff_role[]) then raise exception 'not allowed' using errcode = '42501'; end if;
  else
    if not exists (select 1 from public.staff s where s.club_id = p_club and s.user_id = (select auth.uid())
                   and (s.role = 'owner' or (s.role = 'branch_manager' and s.branch_id = p_branch))) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  if not private.mfa_ok(p_club) then raise exception 'MFA required' using errcode = '42501'; end if;
  if (select count(*) from public.conversations where club_id = p_club and kind = 'staff') >= 20 then
    raise exception 'too many staff channels';
  end if;
  insert into public.conversations (club_id, branch_id, kind, title, created_by)
    values (p_club, p_branch, 'staff', v_title, (select auth.uid())) returning id into v;
  return v;
end $f$;

create function public.open_announcement_channel(p_club uuid, p_branch uuid, p_title text default 'Announcements') returns uuid
language plpgsql security definer set search_path = '' as $f$
declare v uuid; v_title text := coalesce(nullif(btrim(p_title), ''), 'Announcements');
begin
  if not private.real_user() then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_title) > 80 then raise exception 'invalid title'; end if;
  if p_branch is null then
    if not private.staff_in_scope(p_club, null, array['owner']::public.staff_role[]) then raise exception 'not allowed' using errcode = '42501'; end if;
  else
    if not exists (select 1 from public.staff s where s.club_id = p_club and s.user_id = (select auth.uid())
                   and (s.role = 'owner' or (s.role = 'branch_manager' and s.branch_id = p_branch))) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  if not private.mfa_ok(p_club) then raise exception 'MFA required' using errcode = '42501'; end if;
  insert into public.conversations (club_id, branch_id, kind, title, created_by)
    values (p_club, p_branch, 'announcement', v_title, (select auth.uid()))
    on conflict (club_id, (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))) where kind = 'announcement' do nothing
    returning id into v;
  if v is null then
    select id into v from public.conversations where club_id = p_club and kind = 'announcement'
      and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_branch, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;
  return v;
end $f$;

create function public.send_message(p_conversation uuid, p_body text, p_image_path text default null) returns uuid
language plpgsql security definer set search_path = '' as $f$
declare
  c public.conversations; uid uuid := (select auth.uid());
  v_body text := nullif(btrim(p_body), '');
  v_role text; v_name text; v_id uuid; n integer; v_is_member boolean;
begin
  if not private.real_user() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.conversations where id = p_conversation;
  if not found or not private.conv_access(p_conversation, true) then
    raise exception 'cannot post here' using errcode = '42501';
  end if;
  if v_body is null and p_image_path is null then raise exception 'empty message'; end if;
  if v_body is not null and char_length(v_body) > 4000 then raise exception 'message too long'; end if;
  if c.kind = 'announcement' and not private.mfa_ok(c.club_id) then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_image_path is not null then
    if p_image_path !~ ('^' || c.club_id::text || '/' || c.id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') then
      raise exception 'invalid image path';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'chat-images' and o.name = p_image_path) then
      raise exception 'image not found';
    end if;
  end if;
  select count(*) into n from public.messages where sender_user_id = uid and created_at > now() - interval '1 minute';
  if n >= 20 then raise exception 'too many messages' using errcode = '54000'; end if;

  v_is_member := c.member_id is not null and private.is_own_member(c.club_id, c.member_id);
  if v_is_member then
    v_role := 'member';
    select full_name into v_name from public.members where id = c.member_id;
  else
    select s.role::text into v_role from public.staff s where s.club_id = c.club_id and s.user_id = uid
      order by (s.role = 'owner') desc, (s.branch_id is null) desc limit 1;
  end if;
  if v_role is null then raise exception 'not allowed' using errcode = '42501'; end if;

  insert into public.messages (club_id, conversation_id, sender_user_id, sender_role, sender_name, body, image_path)
    values (c.club_id, c.id, uid, v_role, v_name, v_body, p_image_path) returning id into v_id;
  return v_id;
end $f$;

create function public.mark_read(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $f$
begin
  if not private.real_user() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not private.conv_access(p_conversation, false) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
    values (p_conversation, (select auth.uid()), now())
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
end $f$;

revoke execute on function public.open_support_conversation(uuid), public.assign_trainer(uuid, uuid), public.end_trainer_assignment(uuid),
  public.create_staff_channel(uuid, uuid, text), public.open_announcement_channel(uuid, uuid, text),
  public.send_message(uuid, text, text), public.mark_read(uuid) from public, anon;
grant execute on function public.open_support_conversation(uuid), public.assign_trainer(uuid, uuid), public.end_trainer_assignment(uuid),
  public.create_staff_channel(uuid, uuid, text), public.open_announcement_channel(uuid, uuid, text),
  public.send_message(uuid, text, text), public.mark_read(uuid) to authenticated;

create view public.conversation_unread with (security_invoker = true) as
select c.id as conversation_id,
       count(m.id) filter (where m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
                             and m.sender_user_id <> (select auth.uid())) as unread
from public.conversations c
left join public.messages m on m.conversation_id = c.id
left join public.conversation_reads r on r.conversation_id = c.id and r.user_id = (select auth.uid())
group by c.id, r.last_read_at;
revoke all on public.conversation_unread from public, anon;
grant select on public.conversation_unread to authenticated;
