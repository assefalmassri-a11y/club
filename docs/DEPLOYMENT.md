# Deployment

## Hosting
Upload the folder (without `door-device/`, `tests/`, `scripts/`, `supabase/`, `docs/`; keep `privacy.html` and `terms.html`, which are templates to complete and have reviewed by a lawyer) to any HTTPS static host (GitHub Pages today). For a commercial launch use your own domain and a separate staging project.

## One-time Supabase settings (dashboard, cannot be set from SQL)
- Authentication: enable Confirm email; keep Anonymous sign-ins off; enable MFA (TOTP), CAPTCHA, leaked-password protection and a minimum password length.
- Authentication → URL Configuration: Site URL and Redirect URLs for the staff app and `/member/` (needed for password reset links).
- Database: enable backups (PITR if the plan allows) and restrict network access.
- Keep the `service_role` key on the server only (Edge Functions, door gateway), never in the apps.

## Platform admin
After the phase 19 migration, give yourself platform access (uid from Authentication → Users):
```sql
insert into public.platform_admins (user_id) values ('<uid>');
```

## Door device
See `door-device/README.md`. Exit must always work mechanically (emergency release), independent of the program, the network and power.
