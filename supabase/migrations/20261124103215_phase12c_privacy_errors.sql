
create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.data_requests enable row level security;
revoke all on public.data_requests from public, anon, authenticated;
grant select on public.data_requests to authenticated;
create policy data_requests_read on public.data_requests for select to authenticated
  using (private.has_role(club_id, array['owner','branch_manager']::public.staff_role[]));

create or replace function public.request_data_deletion()
returns void language plpgsql security definer set search_path = '' as $$
declare m public.members%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into m from public.members where user_id = auth.uid() order by created_at limit 1;
  if not found then raise exception 'not a member' using errcode = '42501'; end if;
  if exists (select 1 from public.data_requests where member_id = m.id and done_at is null) then return; end if;
  insert into public.data_requests (club_id, member_id) values (m.club_id, m.id);
  perform private.write_audit(m.club_id, 'access', 'data_deletion_requested', m.id, '{}'::jsonb);
end; $$;

create or replace function public.anonymize_member(p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.members%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into m from public.members where id = p_member for update;
  if not found or not private.has_branch_role(m.club_id, m.branch_id, array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.mfa_ok(m.club_id) then raise exception 'MFA required' using errcode = '42501'; end if;
  delete from public.push_subscriptions where user_id = m.user_id;
  delete from public.member_pins where member_id = p_member;
  delete from public.member_notes where member_id = p_member;
  update public.members set full_name = 'عضو محذوف #' || member_no, phone = null, email = null, birth_date = null,
         user_id = null, status = 'cancelled' where id = p_member;
  update public.memberships set status = 'cancelled' where member_id = p_member and status in ('active','paused');
  update public.data_requests set done_at = now() where member_id = p_member and done_at is null;
  perform private.write_audit(m.club_id, 'access', 'member_anonymized', p_member, '{}'::jsonb);
end; $$;
revoke all on function public.request_data_deletion() from public, anon;
revoke all on function public.anonymize_member(uuid) from public, anon;
grant execute on function public.request_data_deletion() to authenticated;
grant execute on function public.anonymize_member(uuid) to authenticated;

create table public.client_errors (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id) on delete cascade,
  user_id uuid,
  app text not null check (app in ('staff','member')),
  message text not null check (char_length(message) <= 300),
  page text check (char_length(page) <= 100),
  created_at timestamptz not null default now()
);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from public, anon, authenticated;
grant select on public.client_errors to authenticated;
create policy client_errors_owner_read on public.client_errors for select to authenticated
  using (club_id is not null and private.has_role(club_id, array['owner']::public.staff_role[]));
create index client_errors_club_idx on public.client_errors (club_id, created_at desc);

create or replace function public.log_client_error(p_app text, p_message text, p_page text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid;
begin
  if not private.real_user() then return; end if;
  if p_app not in ('staff','member') then return; end if;
  if (select count(*) from public.client_errors where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then return; end if;
  select club_id into v_club from public.staff where user_id = auth.uid() limit 1;
  if v_club is null then select club_id into v_club from public.members where user_id = auth.uid() limit 1; end if;
  insert into public.client_errors (club_id, user_id, app, message, page)
    values (v_club, auth.uid(), p_app, left(coalesce(p_message,''), 300), left(p_page, 100));
  delete from public.client_errors where created_at < now() - interval '30 days';
end; $$;
revoke all on function public.log_client_error(text,text,text) from public, anon;
grant execute on function public.log_client_error(text,text,text) to authenticated;
