create table public.payroll_payments(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  period date not null check (extract(day from period)=1),
  currency text not null,
  amount_minor bigint not null check (amount_minor>0),
  ledger_entry_id uuid not null references public.ledger_entries(id),
  paid_by uuid default auth.uid(),
  paid_at timestamptz not null default now(),
  unique(club_id,staff_id,period));
alter table public.payroll_payments enable row level security;
create policy pp_owner_read on public.payroll_payments for select to authenticated
  using (private.real_user() and private.has_role(club_id, array['owner']::public.staff_role[]));
grant select on public.payroll_payments to authenticated;

create or replace function public.pay_trainer_month(p_club uuid,p_staff uuid,p_month date)
returns uuid language plpgsql security definer set search_path='' as $$
declare per date:=date_trunc('month',p_month)::date; r record; br uuid; lid uuid; today date;
begin
  if not (private.real_user() and private.mfa_ok(p_club) and private.has_role(p_club, array['owner']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if per > private.club_today(p_club) then raise exception 'future_period'; end if;
  select * into r from public.trainer_payroll(p_club, per, (per + interval '1 month - 1 day')::date) x where x.staff_id=p_staff;
  if not found or r.amount<=0 then raise exception 'nothing_to_pay'; end if;
  select coalesce(s.branch_id,(select b.id from public.branches b where b.club_id=p_club order by b.created_at limit 1)) into br from public.staff s where s.id=p_staff and s.club_id=p_club;
  today := private.club_today(p_club);
  insert into public.ledger_entries(club_id,branch_id,kind,entry_date,label,currency,amount_minor,created_by)
  values(p_club,br,'expense',today,'راتب مدرب '||to_char(per,'YYYY-MM')||' — '||coalesce(r.email,''),upper(r.currency),r.amount,auth.uid()) returning id into lid;
  begin
    insert into public.payroll_payments(club_id,staff_id,period,currency,amount_minor,ledger_entry_id) values(p_club,p_staff,per,upper(r.currency),r.amount,lid);
  exception when unique_violation then raise exception 'already_paid';
  end;
  perform private.write_audit(p_club,'payroll','pay',p_staff,jsonb_build_object('period',per,'amount_minor',r.amount,'currency',upper(r.currency)));
  return lid;
end $$;
revoke all on function public.pay_trainer_month from public,anon;
grant execute on function public.pay_trainer_month to authenticated;
