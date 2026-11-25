
create table private.member_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  member_id uuid not null,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (member_id, club_id) references public.members(id, club_id) on delete cascade
);
alter table private.member_invites enable row level security;
revoke all on private.member_invites from public, anon, authenticated;

create table private.invite_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  ok boolean not null,
  created_at timestamptz not null default now()
);
alter table private.invite_attempts enable row level security;
revoke all on private.invite_attempts from public, anon, authenticated;
create index on private.invite_attempts (user_id, created_at);

-- Allow the claim function (and only it) to link a login to a member.
create or replace function private.member_link_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.club_id <> old.club_id then
    raise exception 'member club is immutable' using errcode = '42501';
  end if;
  if auth.uid() is not null and (
       (tg_op = 'INSERT' and new.user_id is not null)
    or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id)) then
    if not (
         coalesce(current_setting('app.member_claim', true), '') = '1'
         and tg_op = 'UPDATE' and old.user_id is null and new.user_id = auth.uid()
       ) and not private.has_branch_role(new.club_id, new.branch_id,
         array['owner','branch_manager']::public.staff_role[]) then
      raise exception 'only owners or branch managers can link a member to a login' using errcode = '42501';
    end if;
    perform private.write_audit(new.club_id, 'access', 'member_link', new.id,
      jsonb_build_object('user_id', new.user_id));
  end if;
  return new;
end; $$;

create or replace function public.create_member_invite(p_member_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_m public.members%rowtype; v_code text;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_m from public.members where id = p_member_id;
  if not found or not private.has_branch_role(v_m.club_id, v_m.branch_id,
       array['owner','branch_manager','staff']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_m.user_id is not null then raise exception 'member already linked'; end if;
  delete from private.member_invites where member_id = v_m.id and used_at is null;
  v_code := upper(substr(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'utf8')), 'hex'), 1, 12));
  insert into private.member_invites (club_id, member_id, code_hash, expires_at, created_by)
    values (v_m.club_id, v_m.id, encode(sha256(convert_to(v_code, 'utf8')), 'hex'), now() + interval '7 days', auth.uid());
  perform private.write_audit(v_m.club_id, 'access', 'member_invite_created', v_m.id, '{}'::jsonb);
  return v_code;
end; $$;

create or replace function public.claim_member_invite(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv private.member_invites%rowtype; v_code text;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select count(*) from private.invite_attempts where user_id = auth.uid() and not ok
        and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'too many attempts' using errcode = '42501';
  end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into v_inv from private.member_invites
   where code_hash = encode(sha256(convert_to(v_code, 'utf8')), 'hex')
     and used_at is null and expires_at > now() for update;
  if not found then
    insert into private.invite_attempts (user_id, ok) values (auth.uid(), false);
    raise exception 'invalid or expired code' using errcode = '42501';
  end if;
  perform set_config('app.member_claim', '1', true);
  update public.members set user_id = auth.uid()
   where id = v_inv.member_id and club_id = v_inv.club_id and user_id is null;
  perform set_config('app.member_claim', '0', true);
  if not found then
    insert into private.invite_attempts (user_id, ok) values (auth.uid(), false);
    raise exception 'invalid or expired code' using errcode = '42501';
  end if;
  update private.member_invites set used_at = now() where id = v_inv.id;
  insert into private.invite_attempts (user_id, ok) values (auth.uid(), true);
  return v_inv.club_id;
end; $$;

revoke all on function public.create_member_invite(uuid) from public, anon;
revoke all on function public.claim_member_invite(text) from public, anon;
grant execute on function public.create_member_invite(uuid) to authenticated;
grant execute on function public.claim_member_invite(text) to authenticated;
