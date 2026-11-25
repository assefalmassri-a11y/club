create table public.products(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  price_minor bigint not null check (price_minor>0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  stock int not null default 0 check (stock>=0),
  low_stock int not null default 5 check (low_stock>=0),
  active boolean not null default true,
  created_at timestamptz not null default now());
create table public.sales(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null, branch_id uuid not null,
  product_id uuid not null references public.products(id),
  member_id uuid references public.members(id) on delete set null,
  qty int not null check (qty>0),
  unit_minor bigint not null, total_minor bigint not null, currency text not null,
  method text not null default 'cash' check (method in ('cash','transfer','card','other')),
  ledger_entry_id uuid references public.ledger_entries(id),
  sold_by uuid default auth.uid(), sold_at timestamptz not null default now());
alter table public.products enable row level security;
alter table public.sales enable row level security;
create policy products_read on public.products for select to authenticated using (private.real_user() and private.nontrainer_scope(club_id,branch_id));
create policy sales_read on public.sales for select to authenticated using (private.real_user() and private.nontrainer_scope(club_id,branch_id));
grant select on public.products,public.sales to authenticated;

create or replace function public.save_product(p_id uuid,p_branch uuid,p_name text,p_price bigint,p_currency text,p_stock int,p_low int,p_active boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid; pid uuid;
begin
  select club_id into c from public.branches where id=p_branch;
  if c is null or not (private.real_user() and private.mfa_ok(c) and private.has_branch_role(c,p_branch,array['owner','branch_manager']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if p_id is null then
    insert into public.products(club_id,branch_id,name,price_minor,currency,stock,low_stock,active)
    values(c,p_branch,trim(p_name),p_price,upper(p_currency),p_stock,p_low,p_active) returning id into pid;
  else
    update public.products set name=trim(p_name),price_minor=p_price,currency=upper(p_currency),stock=p_stock,low_stock=p_low,active=p_active
     where id=p_id and club_id=c and branch_id=p_branch returning id into pid;
    if pid is null then raise exception 'not_found'; end if;
  end if;
  perform private.write_audit(c,'shop','product_save',pid,jsonb_build_object('stock',p_stock));
  return pid;
end $$;

create or replace function public.sell_product(p_product uuid,p_qty int,p_member uuid,p_method text)
returns uuid language plpgsql security definer set search_path='' as $$
declare pr public.products%rowtype; lid uuid; sid uuid;
begin
  if p_qty<1 or p_qty>1000 then raise exception 'bad_qty'; end if;
  select * into pr from public.products where id=p_product for update;
  if not found or not pr.active or not (private.real_user() and private.has_branch_role(pr.club_id,pr.branch_id,array['owner','branch_manager','staff']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if p_member is not null and not exists(select 1 from public.members where id=p_member and club_id=pr.club_id) then raise exception 'forbidden' using errcode='42501'; end if;
  if pr.stock<p_qty then raise exception 'out_of_stock'; end if;
  update public.products set stock=stock-p_qty where id=pr.id;
  insert into public.ledger_entries(club_id,branch_id,kind,entry_date,label,currency,amount_minor,created_by)
  values(pr.club_id,pr.branch_id,'income',private.club_today(pr.club_id),'بيع: '||pr.name||' ×'||p_qty,pr.currency,pr.price_minor*p_qty,auth.uid()) returning id into lid;
  insert into public.sales(club_id,branch_id,product_id,member_id,qty,unit_minor,total_minor,currency,method,ledger_entry_id)
  values(pr.club_id,pr.branch_id,pr.id,p_member,p_qty,pr.price_minor,pr.price_minor*p_qty,pr.currency,coalesce(p_method,'cash'),lid) returning id into sid;
  perform private.write_audit(pr.club_id,'shop','sale',sid,jsonb_build_object('qty',p_qty,'total_minor',pr.price_minor*p_qty));
  return sid;
end $$;

create table public.equipment(
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  status text not null default 'ok' check (status in ('ok','needs_service','out_of_order')),
  last_service date, next_service date,
  note text check (char_length(note)<=300),
  created_at timestamptz not null default now());
create table public.equipment_logs(
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  club_id uuid not null, status text not null, note text,
  by_user uuid default auth.uid(), at timestamptz not null default now());
alter table public.equipment enable row level security;
alter table public.equipment_logs enable row level security;
create policy eq_read on public.equipment for select to authenticated using (private.real_user() and private.nontrainer_scope(club_id,branch_id));
create policy eq_log_read on public.equipment_logs for select to authenticated using (private.real_user() and exists(select 1 from public.equipment e where e.id=equipment_id and private.nontrainer_scope(e.club_id,e.branch_id)));
grant select on public.equipment,public.equipment_logs to authenticated;

create or replace function public.save_equipment(p_id uuid,p_branch uuid,p_name text,p_next date)
returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid; eid uuid;
begin
  select club_id into c from public.branches where id=p_branch;
  if c is null or not (private.real_user() and private.has_branch_role(c,p_branch,array['owner','branch_manager']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if p_id is null then insert into public.equipment(club_id,branch_id,name,next_service) values(c,p_branch,trim(p_name),p_next) returning id into eid;
  else update public.equipment set name=trim(p_name),next_service=p_next where id=p_id and club_id=c returning id into eid;
       if eid is null then raise exception 'not_found'; end if; end if;
  return eid;
end $$;

create or replace function public.set_equipment_status(p_id uuid,p_status text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare e public.equipment%rowtype;
begin
  select * into e from public.equipment where id=p_id for update;
  if not found or not (private.real_user() and private.has_branch_role(e.club_id,e.branch_id,array['owner','branch_manager','staff']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if p_status not in ('ok','needs_service','out_of_order') then raise exception 'bad_status'; end if;
  update public.equipment set status=p_status, note=left(nullif(trim(p_note),''),300),
     last_service=case when p_status='ok' and e.status<>'ok' then private.club_today(e.club_id) else last_service end where id=e.id;
  insert into public.equipment_logs(equipment_id,club_id,status,note) values(e.id,e.club_id,p_status,left(nullif(trim(p_note),''),300));
  perform private.write_audit(e.club_id,'equipment','status',e.id,jsonb_build_object('status',p_status));
end $$;
revoke all on function public.save_product,public.sell_product,public.save_equipment,public.set_equipment_status from public,anon;
grant execute on function public.save_product,public.sell_product,public.save_equipment,public.set_equipment_status to authenticated;
