
create or replace function private.generate_monthly_invoices(p_force_date date default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  r record; v_today date; v_label text; v_number bigint; v_id uuid; v_next date; n int := 0;
begin
  for r in
    select ms.id ms_id, ms.member_id, ms.club_id, m.branch_id, m.user_id, pl.price_cents, pl.currency, ms.ends_on
      from public.memberships ms
      join public.membership_plans pl on pl.id = ms.plan_id
      join public.members m on m.id = ms.member_id
     where pl.calendar and ms.status = 'active' and m.status = 'active'
  loop
    v_today := coalesce(p_force_date, private.club_today(r.club_id));
    continue when p_force_date is null and extract(day from v_today) <> 15;
    -- only memberships that end this month (they renew on the 1st)
    continue when r.ends_on <> (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
    v_next := (date_trunc('month', v_today) + interval '1 month')::date;
    v_label := 'تجديد اشتراك ' || to_char(v_next, 'YYYY-MM');
    -- already renewed or already invoiced
    continue when exists (select 1 from public.memberships x where x.member_id = r.member_id and x.status in ('active','paused') and x.ends_on >= v_next);
    continue when exists (select 1 from public.invoices i where i.member_id = r.member_id and i.label = v_label and i.status <> 'void');

    insert into public.invoice_counters (club_id, last_number) values (r.club_id, 1)
      on conflict (club_id) do update set last_number = public.invoice_counters.last_number + 1
      returning last_number into v_number;
    insert into public.invoices (club_id, branch_id, member_id, membership_id, number, label, issue_date, due_date, currency, amount_minor)
      values (r.club_id, r.branch_id, r.member_id, r.ms_id, v_number, v_label, v_today,
              (date_trunc('month', v_today) + interval '1 month - 1 day')::date, r.currency, r.price_cents)
      returning id into v_id;
    perform private.write_audit(r.club_id, 'finance', 'invoice_auto_create', v_id,
      jsonb_build_object('number', v_number, 'member_id', r.member_id, 'amount_minor', r.price_cents));
    n := n + 1;
  end loop;
  return n;
end; $$;

create or replace function private.push_overdue_reminders()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select i.id, m.user_id, (private.club_today(i.club_id) - i.due_date) as late
      from public.invoices i join public.members m on m.id = i.member_id
     where i.status = 'issued' and m.user_id is not null
       and (private.club_today(i.club_id) - i.due_date) in (0, 3)
  loop
    perform private.push_send(array[r.user_id], 'Club', case when r.late = 0 then 'فاتورتك تستحق اليوم' else 'لديك فاتورة متأخرة' end);
  end loop;
end; $$;

revoke all on function private.generate_monthly_invoices(date) from public, anon, authenticated;
revoke all on function private.push_overdue_reminders() from public, anon, authenticated;

select cron.schedule('monthly-invoices', '0 5 * * *', $$select private.generate_monthly_invoices()$$);
select cron.schedule('overdue-reminders', '0 7 * * *', $$select private.push_overdue_reminders()$$);
