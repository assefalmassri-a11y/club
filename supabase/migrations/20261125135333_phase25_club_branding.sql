-- Phase 25: club branding (colour + logo) under platform control (allowed palette, custom colours, logos).
alter table public.clubs
  add column brand_color text check (brand_color is null or brand_color ~ '^#[0-9a-f]{6}$'),
  add column logo_path text check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}/logo\.png$');

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated, public;
insert into public.platform_settings (key, value) values ('branding', jsonb_build_object(
  'palette', jsonb_build_array('#0d9488', '#4f46e5', '#0284c7', '#d97706', '#e11d48', '#7c3aed', '#16a34a', '#475569'),
  'allow_custom', true, 'allow_logo', true));

create function public.branding_options() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select value from public.platform_settings where key = 'branding');
end; $$;

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

-- Brand columns change only through the functions below.
create function private.clubs_brand_bu() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.brand_color, new.logo_path) is distinct from (old.brand_color, old.logo_path) and coalesce(current_setting('club.brand', true), '') <> '1' then
    raise exception 'branding is managed by set_club_color / set_club_logo' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger clubs_brand_bu before update on public.clubs for each row execute function private.clubs_brand_bu();

create function public.set_club_color(p_club uuid, p_color text) returns void
language plpgsql security definer set search_path = '' as $$
declare o jsonb; col text := lower(p_color);
begin
  if not private.real_user() or not private.has_role(p_club, array['owner']::public.staff_role[]) or not private.mfa_ok(p_club) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if col is not null then
    if col !~ '^#[0-9a-f]{6}$' then raise exception 'invalid colour' using errcode = '22023'; end if;
    select value into o from public.platform_settings where key = 'branding';
    if not (o -> 'palette') ? col and not coalesce((o ->> 'allow_custom')::boolean, false) then
      raise exception 'colour not allowed' using errcode = '22023';
    end if;
  end if;
  perform set_config('club.brand', '1', true);
  update public.clubs set brand_color = col where id = p_club;
  perform private.write_audit(p_club, 'access', 'club_color', p_club, jsonb_build_object('color', col));
end; $$;

create function public.set_club_logo(p_club uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.real_user() or not private.has_role(p_club, array['owner']::public.staff_role[]) or not private.mfa_ok(p_club) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_path is not null then
    if p_path <> p_club::text || '/logo.png' then raise exception 'invalid path' using errcode = '22023'; end if;
    if not coalesce((select (value ->> 'allow_logo')::boolean from public.platform_settings where key = 'branding'), false) then
      raise exception 'logos are disabled' using errcode = '22023';
    end if;
  end if;
  perform set_config('club.brand', '1', true);
  update public.clubs set logo_path = p_path where id = p_club;
  perform private.write_audit(p_club, 'access', 'club_logo', p_club, jsonb_build_object('set', p_path is not null));
end; $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-logos', 'club-logos', false, 524288, array['image/png']) on conflict (id) do nothing;

create function private.logo_object_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare c uuid;
begin
  if not private.real_user() then return false; end if;
  if p_name !~ '^[0-9a-f-]{36}/logo\.png$' then return false; end if;
  c := split_part(p_name, '/', 1)::uuid;
  if p_write then return private.has_role(c, array['owner']::public.staff_role[]); end if;
  return private.is_club_staff(c) or private.is_club_member(c);
end; $$;
revoke all on function private.logo_object_ok(text, boolean) from public, anon;
grant execute on function private.logo_object_ok(text, boolean) to authenticated;

create policy club_logos_read on storage.objects for select to authenticated
  using (bucket_id = 'club-logos' and private.logo_object_ok(name, false));
create policy club_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'club-logos' and private.logo_object_ok(name, true));
create policy club_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'club-logos' and private.logo_object_ok(name, true))
  with check (bucket_id = 'club-logos' and private.logo_object_ok(name, true));
create policy club_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'club-logos' and private.logo_object_ok(name, true));

revoke all on function public.branding_options(), public.platform_set_branding(text[], boolean, boolean), public.set_club_color(uuid, text), public.set_club_logo(uuid, text) from public, anon;
grant execute on function public.branding_options(), public.platform_set_branding(text[], boolean, boolean), public.set_club_color(uuid, text), public.set_club_logo(uuid, text) to authenticated;
