create type public.invoice_status as enum ('issued','paid','void');
create type public.ledger_kind as enum ('income','expense');

alter table public.memberships add unique (id, club_id);

-- per-club sequential invoice numbers (only touched by security definer functions)
create table public.invoice_counters (
  club_id uuid primary key references public.clubs(id) on delete restrict,
  last_number bigint not null default 0
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  branch_id uuid not null,
  member_id uuid not null,
  membership_id uuid,
  number bigint not null,
  label text not null check (char_length(label) between 1 and 120),
  issue_date date not null,
  due_date date not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 1000000000000),
  status public.invoice_status not null default 'issued',
  paid_on date,
  void_reason text,
  voided_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (due_date >= issue_date),
  check (status <> 'paid' or paid_on is not null),
  check (status <> 'void' or voided_at is not null),
  unique (id, club_id),
  unique (club_id, number),
  foreign key (branch_id, club_id) references public.branches(id, club_id),
  foreign key (member_id, club_id) references public.members(id, club_id),
  foreign key (membership_id, club_id) references public.memberships(id, club_id)
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  branch_id uuid not null,
  kind public.ledger_kind not null,
  entry_date date not null,
  label text not null check (char_length(label) between 1 and 120),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 1000000000000),
  invoice_id uuid,
  voided_at timestamptz,
  void_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (voided_at is null or void_reason is not null),
  foreign key (branch_id, club_id) references public.branches(id, club_id),
  foreign key (invoice_id, club_id) references public.invoices(id, club_id)
);

create unique index ledger_one_live_entry_per_invoice
  on public.ledger_entries (invoice_id) where invoice_id is not null and voided_at is null;

create index on public.invoices (club_id, branch_id, status);
create index on public.invoices (club_id, member_id);
create index on public.invoices (club_id, due_date) where status = 'issued';
create index on public.ledger_entries (club_id, branch_id, entry_date);

-- Immutability: financial rows are frozen; only status/void transitions are allowed
create function private.invoice_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'invoices cannot be deleted; void them instead' using errcode = '42501';
  end if;
  if new.club_id <> old.club_id or new.branch_id <> old.branch_id or new.member_id <> old.member_id
     or new.membership_id is distinct from old.membership_id or new.number <> old.number
     or new.label <> old.label or new.issue_date <> old.issue_date or new.due_date <> old.due_date
     or new.currency <> old.currency or new.amount_minor <> old.amount_minor
     or new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'invoice fields are immutable' using errcode = '42501';
  end if;
  if new.status = old.status then
    raise exception 'invoice can only change status' using errcode = '42501';
  end if;
  if not ((old.status = 'issued' and new.status in ('paid','void'))
       or (old.status = 'paid' and new.status = 'void')) then
    raise exception 'invalid invoice status transition % -> %', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger invoice_guard_bud before update or delete on public.invoices
  for each row execute function private.invoice_guard();
create trigger invoice_no_truncate before truncate on public.invoices
  for each statement execute function private.deny_change();

create function private.ledger_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ledger entries cannot be deleted; void them instead' using errcode = '42501';
  end if;
  if (new.club_id, new.branch_id, new.kind, new.entry_date, new.label, new.currency, new.amount_minor, new.created_at)
       is distinct from
     (old.club_id, old.branch_id, old.kind, old.entry_date, old.label, old.currency, old.amount_minor, old.created_at)
     or new.invoice_id is distinct from old.invoice_id
     or new.created_by is distinct from old.created_by then
    raise exception 'ledger entry fields are immutable' using errcode = '42501';
  end if;
  if old.voided_at is not null then
    raise exception 'a void ledger entry cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger ledger_guard_bud before update or delete on public.ledger_entries
  for each row execute function private.ledger_guard();
create trigger ledger_no_truncate before truncate on public.ledger_entries
  for each statement execute function private.deny_change();

-- RLS: read-only for clients; all writes go through the functions below
alter table public.invoice_counters enable row level security;  -- no policies on purpose
alter table public.invoices enable row level security;
alter table public.ledger_entries enable row level security;

revoke all on public.invoices, public.ledger_entries, public.invoice_counters from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.invoices, public.ledger_entries, public.invoice_counters from authenticated;
revoke select on public.invoice_counters from authenticated;

create policy no_anonymous on public.invoices as restrictive for all to authenticated using (private.real_user());
create policy no_anonymous on public.ledger_entries as restrictive for all to authenticated using (private.real_user());

create policy invoices_staff_read on public.invoices for select to authenticated
  using (private.has_branch_role(club_id, branch_id, array['owner','branch_manager','staff']::public.staff_role[]));
create policy invoices_member_read on public.invoices for select to authenticated
  using (private.is_own_member(club_id, member_id));
create policy ledger_read on public.ledger_entries for select to authenticated
  using (private.has_branch_role(club_id, branch_id, array['owner','branch_manager']::public.staff_role[]));

-- Totals per branch and currency (live entries only); respects the caller's RLS
create view public.ledger_totals with (security_invoker = true) as
select
  club_id, branch_id, currency,
  coalesce(sum(amount_minor) filter (where kind = 'income'), 0)::bigint  as income_minor,
  coalesce(sum(amount_minor) filter (where kind = 'expense'), 0)::bigint as expense_minor,
  (coalesce(sum(amount_minor) filter (where kind = 'income'), 0)
   - coalesce(sum(amount_minor) filter (where kind = 'expense'), 0))::bigint as balance_minor
from public.ledger_entries
where voided_at is null
group by club_id, branch_id, currency;
revoke all on public.ledger_totals from anon;
revoke truncate, references, trigger, insert, update, delete on public.ledger_totals from authenticated;

-- ===== Functions =====
create function public.create_invoice(
  p_member_id uuid, p_label text, p_issue_date date, p_due_date date,
  p_currency char(3), p_amount_minor bigint, p_membership_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members%rowtype;
  v_number bigint;
  v_id uuid;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_member from public.members where id = p_member_id;
  if not found or not private.has_branch_role(v_member.club_id, v_member.branch_id,
       array['owner','branch_manager','staff']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_membership_id is not null and not exists (
       select 1 from public.memberships
       where id = p_membership_id and club_id = v_member.club_id and member_id = p_member_id) then
    raise exception 'membership does not belong to this member';
  end if;

  insert into public.invoice_counters (club_id, last_number) values (v_member.club_id, 1)
    on conflict (club_id) do update set last_number = public.invoice_counters.last_number + 1
    returning last_number into v_number;

  insert into public.invoices (club_id, branch_id, member_id, membership_id, number, label,
      issue_date, due_date, currency, amount_minor, created_by)
    values (v_member.club_id, v_member.branch_id, p_member_id, p_membership_id, v_number,
      trim(p_label), p_issue_date, p_due_date, upper(p_currency), p_amount_minor, auth.uid())
    returning id into v_id;

  perform private.write_audit(v_member.club_id, 'finance', 'invoice_create', v_id,
    jsonb_build_object('number', v_number, 'member_id', p_member_id,
                       'currency', upper(p_currency), 'amount_minor', p_amount_minor));
  return v_id;
end;
$$;

create function public.mark_invoice_paid(p_invoice_id uuid, p_paid_on date)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_inv public.invoices%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found or not private.has_branch_role(v_inv.club_id, v_inv.branch_id,
       array['owner','branch_manager','staff']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_inv.status <> 'issued' then
    raise exception 'invoice is not payable (status: %)', v_inv.status;
  end if;
  if p_paid_on < v_inv.issue_date or p_paid_on > current_date + 1 then
    raise exception 'invalid payment date';
  end if;

  update public.invoices set status = 'paid', paid_on = p_paid_on where id = p_invoice_id;
  insert into public.ledger_entries (club_id, branch_id, kind, entry_date, label,
      currency, amount_minor, invoice_id, created_by)
    values (v_inv.club_id, v_inv.branch_id, 'income', p_paid_on, v_inv.label,
      v_inv.currency, v_inv.amount_minor, v_inv.id, auth.uid());
  perform private.write_audit(v_inv.club_id, 'finance', 'invoice_paid', p_invoice_id,
    jsonb_build_object('paid_on', p_paid_on, 'currency', v_inv.currency, 'amount_minor', v_inv.amount_minor));
end;
$$;

create function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_inv public.invoices%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found or not private.has_branch_role(v_inv.club_id, v_inv.branch_id,
       array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.mfa_ok(v_inv.club_id) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if v_inv.status = 'void' then raise exception 'invoice is already void'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 160 then
    raise exception 'a reason (1-160 characters) is required';
  end if;

  update public.ledger_entries set voided_at = now(), void_reason = trim(p_reason)
   where invoice_id = p_invoice_id and voided_at is null;
  update public.invoices set status = 'void', voided_at = now(), void_reason = trim(p_reason)
   where id = p_invoice_id;
  perform private.write_audit(v_inv.club_id, 'finance', 'invoice_void', p_invoice_id,
    jsonb_build_object('reason', trim(p_reason), 'was_paid', v_inv.status = 'paid'));
end;
$$;

create function public.add_ledger_entry(
  p_branch_id uuid, p_kind public.ledger_kind, p_date date, p_label text,
  p_currency char(3), p_amount_minor bigint
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_id uuid;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into v_club from public.branches where id = p_branch_id;
  if v_club is null or not private.has_branch_role(v_club, p_branch_id,
       array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.mfa_ok(v_club) then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_date > current_date + 1 then raise exception 'entry date is in the future'; end if;

  insert into public.ledger_entries (club_id, branch_id, kind, entry_date, label,
      currency, amount_minor, created_by)
    values (v_club, p_branch_id, p_kind, p_date, trim(p_label), upper(p_currency),
      p_amount_minor, auth.uid())
    returning id into v_id;
  perform private.write_audit(v_club, 'finance', 'ledger_add', v_id,
    jsonb_build_object('kind', p_kind, 'currency', upper(p_currency), 'amount_minor', p_amount_minor));
  return v_id;
end;
$$;

create function public.void_ledger_entry(p_entry_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_e public.ledger_entries%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_e from public.ledger_entries where id = p_entry_id for update;
  if not found or not private.has_branch_role(v_e.club_id, v_e.branch_id,
       array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.mfa_ok(v_e.club_id) then raise exception 'MFA required' using errcode = '42501'; end if;
  if v_e.voided_at is not null then raise exception 'entry is already void'; end if;
  if v_e.invoice_id is not null then
    raise exception 'void invoice-linked income through its invoice';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 160 then
    raise exception 'a reason (1-160 characters) is required';
  end if;
  update public.ledger_entries set voided_at = now(), void_reason = trim(p_reason) where id = p_entry_id;
  perform private.write_audit(v_e.club_id, 'finance', 'ledger_void', p_entry_id,
    jsonb_build_object('reason', trim(p_reason), 'currency', v_e.currency, 'amount_minor', v_e.amount_minor));
end;
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function public.create_invoice(uuid, text, date, date, character, bigint, uuid) from public, anon;
revoke execute on function public.mark_invoice_paid(uuid, date) from public, anon;
revoke execute on function public.void_invoice(uuid, text) from public, anon;
revoke execute on function public.add_ledger_entry(uuid, public.ledger_kind, date, text, character, bigint) from public, anon;
revoke execute on function public.void_ledger_entry(uuid, text) from public, anon;
grant execute on function public.create_invoice(uuid, text, date, date, character, bigint, uuid) to authenticated;
grant execute on function public.mark_invoice_paid(uuid, date) to authenticated;
grant execute on function public.void_invoice(uuid, text) to authenticated;
grant execute on function public.add_ledger_entry(uuid, public.ledger_kind, date, text, character, bigint) to authenticated;
grant execute on function public.void_ledger_entry(uuid, text) to authenticated;
