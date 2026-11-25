
alter table public.members add column member_no integer;

update public.members m set member_no = x.n + 1000
from (select id, row_number() over (partition by club_id order by created_at, id) n from public.members) x
where x.id = m.id;

alter table public.members alter column member_no set not null;
create unique index members_club_no_uq on public.members (club_id, member_no);

create or replace function private.assign_member_no()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('member_no:' || new.club_id::text, 0));
  select coalesce(max(member_no), 1000) + 1 into new.member_no from public.members where club_id = new.club_id;
  return new;
end; $$;
create trigger members_assign_no before insert on public.members for each row execute function private.assign_member_no();

create or replace function private.member_no_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.member_no is distinct from old.member_no then raise exception 'member_no is immutable' using errcode = '42501'; end if;
  return new;
end; $$;
create trigger members_no_immutable before update on public.members for each row execute function private.member_no_immutable();
