-- Currency is chosen per club at creation time: no global default
alter table public.clubs alter column default_currency drop default;

-- Money amounts as bigint (large-denomination currencies such as SYP)
alter table public.membership_plans alter column price_cents type bigint;
alter table public.memberships alter column price_cents type bigint;

-- create_club: currency is now required
drop function public.create_club(text, text, character, text);

create function public.create_club(
  p_name text,
  p_slug text,
  p_currency char(3),
  p_first_branch text default 'Main'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.clubs (name, slug, default_currency)
    values (p_name, p_slug, upper(p_currency)) returning id into v_club;
  insert into public.branches (club_id, name)
    values (v_club, p_first_branch);
  insert into public.staff (club_id, user_id, role)
    values (v_club, auth.uid(), 'owner');
  return v_club;
end;
$$;
revoke execute on function public.create_club(text, text, character, text) from public, anon;
grant execute on function public.create_club(text, text, character, text) to authenticated;
