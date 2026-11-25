-- Phase 23: full platform-owner control (club details, delete club, plans, platform admins, platform log).
-- Every function is platform-admin only and logs to platform_log.

create function public.platform_club_detail(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'owners', coalesce((select jsonb_agg(u.email) from public.staff s join auth.users u on u.id = s.user_id where s.club_id = p_club and s.role = 'owner'), '[]'::jsonb),
    'staff', (select count(*) from public.staff where club_id = p_club),
    'branches', (select count(*) from public.branches where club_id = p_club),
    'members', (select count(*) from public.members where club_id = p_club),
    'active_members', (select count(*) from public.members where club_id = p_club and status = 'active'),
    'doors', (select count(*) from public.doors where club_id = p_club),
    'invoices', (select count(*) from public.invoices where club_id = p_club),
    'last_checkin', (select max(checked_in_at) from public.checkins where club_id = p_club))
  into r from public.clubs where id = p_club;
  if r is null then raise exception 'club_not_found' using errcode = 'P0002'; end if;
  return r;
end; $$;

-- Permanent delete. p_confirm must equal the club slug. Removes every row of the club, including its audit chain.
create function public.platform_delete_club(p_club uuid, p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.clubs%rowtype; n_members bigint;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from public.clubs where id = p_club for update;
  if not found then raise exception 'club_not_found' using errcode = 'P0002'; end if;
  if p_confirm is distinct from c.slug then raise exception 'confirmation_mismatch' using errcode = '22023'; end if;
  select count(*) into n_members from public.members where club_id = p_club;
  alter table public.audit_log disable trigger audit_no_update;
  delete from public.audit_log where club_id = p_club;
  alter table public.audit_log enable trigger audit_no_update;
  delete from public.club_subscriptions where club_id = p_club;
  delete from public.clubs where id = p_club;
  insert into public.platform_log (actor, club_id, action, detail)
  values ((select auth.uid()), p_club, 'delete_club', jsonb_build_object('name', c.name, 'slug', c.slug, 'members', n_members));
end; $$;

create function public.platform_list_plans() returns setof public.club_plans
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select * from public.club_plans order by coalesce(price_cents, 0), code;
end; $$;

create function public.platform_save_plan(p_code text, p_name text, p_max_branches int, p_max_members int, p_price_cents bigint, p_currency text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.club_plans (code, name, max_branches, max_members, price_cents, currency, active)
  values (p_code, p_name, p_max_branches, p_max_members, p_price_cents, nullif(upper(p_currency), ''), coalesce(p_active, true))
  on conflict (code) do update set name = excluded.name, max_branches = excluded.max_branches, max_members = excluded.max_members,
    price_cents = excluded.price_cents, currency = excluded.currency, active = excluded.active;
  insert into public.platform_log (actor, action, detail)
  values ((select auth.uid()), 'save_plan', jsonb_build_object('code', p_code, 'max_branches', p_max_branches, 'max_members', p_max_members, 'price_cents', p_price_cents));
end; $$;

create function public.platform_list_admins() returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select a.user_id, u.email::text, a.created_at from public.platform_admins a join auth.users u on u.id = a.user_id order by a.created_at;
end; $$;

create function public.platform_add_admin(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  insert into public.platform_admins (user_id) values (uid) on conflict do nothing;
  insert into public.platform_log (actor, action, detail) values ((select auth.uid()), 'add_admin', jsonb_build_object('email', lower(trim(p_email))));
end; $$;

create function public.platform_remove_admin(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select count(*) from public.platform_admins) <= 1 then raise exception 'last_admin' using errcode = '22023'; end if;
  delete from public.platform_admins where user_id = p_user;
  insert into public.platform_log (actor, action, detail) values ((select auth.uid()), 'remove_admin', jsonb_build_object('user', p_user));
end; $$;

create function public.platform_list_log(p_limit int default 100) returns table (at timestamptz, actor_email text, club_id uuid, action text, detail jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select l.at, u.email::text, l.club_id, l.action, l.detail from public.platform_log l left join auth.users u on u.id = l.actor
    order by l.at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end; $$;

revoke all on function public.platform_club_detail(uuid), public.platform_delete_club(uuid, text), public.platform_list_plans(),
  public.platform_save_plan(text, text, int, int, bigint, text, boolean), public.platform_list_admins(), public.platform_add_admin(text),
  public.platform_remove_admin(uuid), public.platform_list_log(int) from public, anon;
grant execute on function public.platform_club_detail(uuid), public.platform_delete_club(uuid, text), public.platform_list_plans(),
  public.platform_save_plan(text, text, int, int, bigint, text, boolean), public.platform_list_admins(), public.platform_add_admin(text),
  public.platform_remove_admin(uuid), public.platform_list_log(int) to authenticated;
