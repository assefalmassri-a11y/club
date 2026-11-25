-- Phase 27: club look & feel beyond the accent colour: background tone, font, text size and tab style (platform can allow or block it).
alter table public.clubs add column theme jsonb not null default '{}'::jsonb check (jsonb_typeof(theme) = 'object');
update public.platform_settings set value = value || '{"allow_theme": true}'::jsonb where key = 'branding';

create or replace function private.clubs_brand_bu() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.brand_color, new.logo_path, new.theme) is distinct from (old.brand_color, old.logo_path, old.theme) and coalesce(current_setting('club.brand', true), '') <> '1' then
    raise exception 'branding is managed by set_club_color / set_club_logo / set_club_theme' using errcode = '42501';
  end if;
  return new;
end; $$;

drop function public.platform_set_branding(text[], boolean, boolean);
create function public.platform_set_branding(p_palette text[], p_allow_custom boolean, p_allow_logo boolean, p_allow_theme boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_palette is null or cardinality(p_palette) not between 1 and 16 then raise exception 'palette must have 1 to 16 colours' using errcode = '22023'; end if;
  foreach c in array p_palette loop
    if c !~ '^#[0-9a-f]{6}$' then raise exception 'invalid colour %', c using errcode = '22023'; end if;
  end loop;
  update public.platform_settings set value = jsonb_build_object('palette', to_jsonb(p_palette), 'allow_custom', coalesce(p_allow_custom, false),
    'allow_logo', coalesce(p_allow_logo, false), 'allow_theme', coalesce(p_allow_theme, false)), updated_at = now()
   where key = 'branding';
  insert into public.platform_log (actor, action, detail)
  values ((select auth.uid()), 'set_branding', jsonb_build_object('palette', p_palette, 'allow_custom', p_allow_custom, 'allow_logo', p_allow_logo, 'allow_theme', p_allow_theme));
end; $$;

create function public.set_club_theme(p_club uuid, p_bg text, p_font text, p_fsize text, p_tabs text) returns void
language plpgsql security definer set search_path = '' as $$
declare t jsonb;
begin
  if not private.real_user() or not private.has_role(p_club, array['owner']::public.staff_role[]) or not private.mfa_ok(p_club) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (value ->> 'allow_theme')::boolean from public.platform_settings where key = 'branding'), false) then
    raise exception 'theme options are disabled' using errcode = '22023';
  end if;
  if p_bg not in ('default', 'plain', 'warm', 'mint', 'sky', 'rose', 'slate')
     or p_font not in ('default', 'classic', 'clear', 'rounded')
     or p_fsize not in ('sm', 'md', 'lg')
     or p_tabs not in ('colorful', 'brand', 'pills', 'minimal') then
    raise exception 'invalid theme option' using errcode = '22023';
  end if;
  t := jsonb_build_object('bg', p_bg, 'font', p_font, 'fsize', p_fsize, 'tabs', p_tabs);
  perform set_config('club.brand', '1', true);
  update public.clubs set theme = t where id = p_club;
  perform set_config('club.brand', '', true);
  perform private.write_audit(p_club, 'access', 'club_theme', p_club, t);
end; $$;

revoke all on function public.platform_set_branding(text[], boolean, boolean, boolean), public.set_club_theme(uuid, text, text, text, text) from public, anon;
grant execute on function public.platform_set_branding(text[], boolean, boolean, boolean), public.set_club_theme(uuid, text, text, text, text) to authenticated;
