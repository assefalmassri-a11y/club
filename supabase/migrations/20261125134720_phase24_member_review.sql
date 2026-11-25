-- Phase 24: members registered by front-desk staff are flagged for review by the gym manager (end of day/week).
alter table public.members
  add column created_by uuid references auth.users(id) on delete set null,
  add column review_status text not null default 'approved' check (review_status in ('pending', 'approved')),
  add column reviewed_by uuid references auth.users(id) on delete set null,
  add column reviewed_at timestamptz;
create index members_pending_idx on public.members (club_id, created_at desc) where review_status = 'pending';

create function private.members_review_bi() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := (select auth.uid());
  new.review_status := 'approved'; new.reviewed_by := null; new.reviewed_at := null;
  if new.created_by is not null
     and exists (select 1 from public.staff s where s.user_id = new.created_by and s.club_id = new.club_id)
     and not private.has_branch_role(new.club_id, new.branch_id, array['owner', 'branch_manager']::public.staff_role[]) then
    new.review_status := 'pending';
  end if;
  return new;
end; $$;
create trigger members_review_bi before insert on public.members for each row execute function private.members_review_bi();

-- The review columns can only be changed through approve_members.
create function private.members_review_bu() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.review_status, new.created_by, new.reviewed_by, new.reviewed_at) is distinct from (old.review_status, old.created_by, old.reviewed_by, old.reviewed_at)
     and coalesce(current_setting('club.review', true), '') <> '1' then
    raise exception 'review columns are managed by approve_members' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger members_review_bu before update on public.members for each row execute function private.members_review_bu();

create function public.members_pending_review(p_club uuid)
returns table (id uuid, member_no int, full_name text, phone text, branch_id uuid, created_at timestamptz, created_by_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.real_user() or not private.has_role(p_club, array['owner', 'branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select m.id, m.member_no, m.full_name, m.phone, m.branch_id, m.created_at, u.email::text
      from public.members m left join auth.users u on u.id = m.created_by
     where m.club_id = p_club and m.review_status = 'pending'
       and private.has_branch_role(m.club_id, m.branch_id, array['owner', 'branch_manager']::public.staff_role[])
     order by m.created_at;
end; $$;

create function public.approve_members(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare m record; n int := 0;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform set_config('club.review', '1', true);
  for m in select id, club_id, branch_id from public.members where id = any (p_ids) and review_status = 'pending' for update loop
    if not private.has_branch_role(m.club_id, m.branch_id, array['owner', 'branch_manager']::public.staff_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    update public.members set review_status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = now() where id = m.id;
    perform private.write_audit(m.club_id, 'access', 'member_reviewed', m.id, '{}'::jsonb);
    n := n + 1;
  end loop;
  return n;
end; $$;

revoke all on function public.members_pending_review(uuid), public.approve_members(uuid[]) from public, anon;
grant execute on function public.members_pending_review(uuid), public.approve_members(uuid[]) to authenticated;
