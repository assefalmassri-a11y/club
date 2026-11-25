-- Phase 28: the club look (background, font, text size, tabs) is set by the platform owner only, not by club owners.
drop function public.set_club_theme(uuid, text, text, text, text);
drop function public.platform_set_branding(text[], boolean, boolean, boolean);
update public.platform_settings set value = value - 'allow_theme' where key = 'branding';

create function public.platform_set_branding(p_palette text[], p_allow_custom boolean, p_allow_logo boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_palette is null or cardinality(p_palette) not between 1 and 16 then raise exception 'palette must have 1 to 16 colours' using errcode = '22023'; end if;
  foreach c in array p_palette loop
    if c !~ '^#[0-9a-f]{6}$' then raise exception 'invalid colour %', c using errcode = '22023'; end if;
  end loop;
  update public.platform_settings set value = jsonb_build_object('palette', to_jsonb(p_palette), 'allow_custom', coalesce(p_allow_custom, false), 'allow_logo', coalesce(p_allow_logo, false)), updated_at = now()
   where key = 'branding';
  insert into public.platform_log (actor, action, detail)
  values ((select auth.uid()), 'set_branding', jsonb_build_object('palette', p_palette, 'allow_custom', p_allow_custom, 'allow_logo', p_allow_logo));
end; $$;

create function public.platform_set_club_theme(p_club uuid, p_bg text, p_font text, p_fsize text, p_tabs text) returns void
language plpgsql security definer set search_path = '' as $$
declare t jsonb;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_bg not in ('default', 'plain', 'warm', 'mint', 'sky', 'rose', 'slate')
     or p_font not in ('default', 'classic', 'clear', 'rounded')
     or p_fsize not in ('sm', 'md', 'lg')
     or p_tabs not in ('colorful', 'brand', 'pills', 'minimal') then
    raise exception 'invalid theme option' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clubs where id = p_club) then raise exception 'club_not_found' using errcode = 'P0002'; end if;
  t := jsonb_build_object('bg', p_bg, 'font', p_font, 'fsize', p_fsize, 'tabs', p_tabs);
  perform set_config('club.brand', '1', true);
  update public.clubs set theme = t where id = p_club;
  perform set_config('club.brand', '', true);
  insert into public.platform_log (actor, action, detail)
  values ((select auth.uid()), 'set_club_theme', jsonb_build_object('club', p_club) || t);
end; $$;

create or replace function public.platform_club_detail(p_club uuid) returns jsonb
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
    'last_checkin', (select max(checked_in_at) from public.checkins where club_id = p_club),
    'theme', theme)
  into r from public.clubs where id = p_club;
  if r is null then raise exception 'club_not_found' using errcode = 'P0002'; end if;
  return r;
end; $$;

revoke all on function public.platform_set_branding(text[], boolean, boolean), public.platform_set_club_theme(uuid, text, text, text, text) from public, anon;
grant execute on function public.platform_set_branding(text[], boolean, boolean), public.platform_set_club_theme(uuid, text, text, text, text) to authenticated;
