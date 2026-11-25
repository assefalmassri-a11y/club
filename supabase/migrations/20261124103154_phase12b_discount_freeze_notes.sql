
alter table public.members add column discount_pct smallint not null default 0 check (discount_pct between 0 and 100);
create or replace function private.member_discount_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (
       (tg_op = 'INSERT' and new.discount_pct <> 0) or (tg_op = 'UPDATE' and new.discount_pct <> old.discount_pct)) then
    if not private.has_role(new.club_id, array['owner','branch_manager']::public.staff_role[]) then
      raise exception 'only owners or branch managers can set discounts' using errcode = '42501';
    end if;
    perform private.write_audit(new.club_id, 'finance', 'member_discount', new.id, jsonb_build_object('pct', new.discount_pct));
  end if;
  return new;
end; $$;
create trigger members_discount_guard before insert or update on public.members for each row execute function private.member_discount_guard();

alter table public.memberships add column paused_at date;
create or replace function private.membership_freeze()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'active' and new.status = 'paused' then
    new.paused_at := private.club_today(new.club_id);
  elsif old.status = 'paused' and new.status = 'active' then
    new.ends_on := old.ends_on + greatest(0, private.club_today(new.club_id) - coalesce(old.paused_at, private.club_today(new.club_id)));
    new.paused_at := null;
  end if;
  return new;
end; $$;
create trigger membership_freeze_bu before update on public.memberships for each row execute function private.membership_freeze();

create or replace function private.generate_monthly_invoices(p_force_date date default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  r record; v_today date; v_label text; v_number bigint; v_id uuid; v_next date; v_amt bigint; n int := 0;
begin
  for r in
    select ms.id ms_id, ms.member_id, ms.club_id, m.branch_id, m.user_id, m.discount_pct, pl.price_cents, pl.currency, ms.ends_on
      from public.memberships ms
      join public.membership_plans pl on pl.id = ms.plan_id
      join public.members m on m.id = ms.member_id
     where pl.calendar and ms.status = 'active' and m.status = 'active'
  loop
    v_today := coalesce(p_force_date, private.club_today(r.club_id));
    continue when p_force_date is null and extract(day from v_today) <> 15;
    continue when r.ends_on <> (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
    v_next := (date_trunc('month', v_today) + interval '1 month')::date;
    v_label := 'تجديد اشتراك ' || to_char(v_next, 'YYYY-MM');
    continue when exists (select 1 from public.memberships x where x.member_id = r.member_id and x.status in ('active','paused') and x.ends_on >= v_next);
    continue when exists (select 1 from public.invoices i where i.member_id = r.member_id and i.label = v_label and i.status <> 'void');
    v_amt := round(r.price_cents * (100 - r.discount_pct) / 100.0);
    insert into public.invoice_counters (club_id, last_number) values (r.club_id, 1)
      on conflict (club_id) do update set last_number = public.invoice_counters.last_number + 1
      returning last_number into v_number;
    insert into public.invoices (club_id, branch_id, member_id, membership_id, number, label, issue_date, due_date, currency, amount_minor)
      values (r.club_id, r.branch_id, r.member_id, r.ms_id, v_number, v_label, v_today,
              (date_trunc('month', v_today) + interval '1 month - 1 day')::date, r.currency, v_amt)
      returning id into v_id;
    perform private.write_audit(r.club_id, 'finance', 'invoice_auto_create', v_id,
      jsonb_build_object('number', v_number, 'member_id', r.member_id, 'amount_minor', v_amt, 'discount_pct', r.discount_pct));
    n := n + 1;
  end loop;
  return n;
end; $$;
revoke all on function private.generate_monthly_invoices(date) from public, anon, authenticated;

create table public.member_notes (
  member_id uuid primary key references public.members(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  note text not null check (char_length(note) <= 1000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.member_notes enable row level security;
revoke all on public.member_notes from public, anon;
grant select, insert, update, delete on public.member_notes to authenticated;
create policy notes_staff on public.member_notes for all to authenticated
  using (private.has_branch_role(club_id, branch_id, array['owner','branch_manager','staff','trainer']::public.staff_role[]))
  with check (private.has_branch_role(club_id, branch_id, array['owner','branch_manager','staff','trainer']::public.staff_role[]));
