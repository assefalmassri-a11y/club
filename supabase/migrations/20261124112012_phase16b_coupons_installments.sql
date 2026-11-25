create table public.coupons(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{3,24}$'),
  pct int not null check (pct between 1 and 100),
  valid_from date, valid_to date,
  max_uses int check (max_uses is null or max_uses>0),
  used int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(club_id,code));
create table public.coupon_uses(
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  used_at timestamptz not null default now(),
  primary key(coupon_id,member_id));
alter table public.coupons enable row level security;
alter table public.coupon_uses enable row level security;
create policy coupons_read on public.coupons for select to authenticated using (private.real_user() and private.has_role(club_id, array['owner','branch_manager','staff']::public.staff_role[]));
grant select on public.coupons to authenticated;

create or replace function public.upsert_coupon(p_club uuid,p_code text,p_pct int,p_from date,p_to date,p_max int,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not (private.real_user() and private.mfa_ok(p_club) and private.has_role(p_club, array['owner','branch_manager']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  insert into public.coupons(club_id,code,pct,valid_from,valid_to,max_uses,active)
  values(p_club,upper(trim(p_code)),p_pct,p_from,p_to,p_max,p_active)
  on conflict(club_id,code) do update set pct=excluded.pct,valid_from=excluded.valid_from,valid_to=excluded.valid_to,max_uses=excluded.max_uses,active=excluded.active;
  perform private.write_audit(p_club,'coupon','upsert',null,jsonb_build_object('code',upper(trim(p_code)),'pct',p_pct,'active',p_active));
end $$;

create or replace function public.redeem_coupon(p_club uuid,p_code text,p_member uuid)
returns int language plpgsql security definer set search_path='' as $$
declare c public.coupons%rowtype; td date;
begin
  if not (private.real_user() and private.has_role(p_club, array['owner','branch_manager','staff']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.members where id=p_member and club_id=p_club) then raise exception 'forbidden' using errcode='42501'; end if;
  td := private.club_today(p_club);
  select * into c from public.coupons where club_id=p_club and code=upper(trim(p_code)) for update;
  if not found or not c.active or (c.valid_from is not null and td<c.valid_from) or (c.valid_to is not null and td>c.valid_to)
     or (c.max_uses is not null and c.used>=c.max_uses) then raise exception 'coupon_invalid'; end if;
  begin insert into public.coupon_uses(coupon_id,member_id) values(c.id,p_member);
  exception when unique_violation then raise exception 'coupon_already_used'; end;
  update public.coupons set used=used+1 where id=c.id;
  perform private.write_audit(p_club,'coupon','redeem',p_member,jsonb_build_object('code',c.code));
  return c.pct;
end $$;

create or replace function public.create_installments(p_member uuid,p_label text,p_total bigint,p_currency text,p_count int,p_first_due date)
returns int language plpgsql security definer set search_path='' as $$
declare i int; base bigint; amt bigint; due date; today date; m public.members%rowtype;
begin
  if p_count<2 or p_count>24 or p_total<p_count then raise exception 'bad_installments'; end if;
  select * into m from public.members where id=p_member;
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  today := private.club_today(m.club_id);
  base := p_total / p_count;
  for i in 1..p_count loop
    amt := case when i=p_count then p_total-base*(p_count-1) else base end;
    due := (p_first_due + ((i-1)||' month')::interval)::date;
    perform public.create_invoice(p_member, trim(p_label)||' ('||i||'/'||p_count||')', today, due, p_currency::char(3), amt, null);
  end loop;
  return p_count;
end $$;
revoke all on function public.upsert_coupon,public.redeem_coupon,public.create_installments from public,anon;
grant execute on function public.upsert_coupon,public.redeem_coupon,public.create_installments to authenticated;
