
alter table public.invoices add column payment_method text check (payment_method in ('cash','transfer','card','other'));
drop function public.mark_invoice_paid(uuid, date);
create or replace function public.mark_invoice_paid(p_invoice_id uuid, p_paid_on date, p_method text default 'cash')
returns void language plpgsql security definer set search_path = '' as $$
declare v_inv public.invoices%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_method not in ('cash','transfer','card','other') then raise exception 'invalid payment method'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found or not private.has_branch_role(v_inv.club_id, v_inv.branch_id,
       array['owner','branch_manager','staff']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_inv.status <> 'issued' then raise exception 'invoice is not payable (status: %)', v_inv.status; end if;
  if p_paid_on < v_inv.issue_date or p_paid_on > current_date + 1 then raise exception 'invalid payment date'; end if;
  update public.invoices set status = 'paid', paid_on = p_paid_on, payment_method = p_method where id = p_invoice_id;
  insert into public.ledger_entries (club_id, branch_id, kind, entry_date, label, currency, amount_minor, invoice_id, created_by)
    values (v_inv.club_id, v_inv.branch_id, 'income', p_paid_on, v_inv.label, v_inv.currency, v_inv.amount_minor, v_inv.id, auth.uid());
  perform private.write_audit(v_inv.club_id, 'finance', 'invoice_paid', p_invoice_id,
    jsonb_build_object('paid_on', p_paid_on, 'method', p_method, 'currency', v_inv.currency, 'amount_minor', v_inv.amount_minor));
end; $$;
revoke all on function public.mark_invoice_paid(uuid, date, text) from public, anon;
grant execute on function public.mark_invoice_paid(uuid, date, text) to authenticated;
