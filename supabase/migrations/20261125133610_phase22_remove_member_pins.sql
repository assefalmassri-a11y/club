-- Phase 22: remove the unused member PIN feature (entry is by cards only).
create or replace function public.anonymize_member(p_member uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare m public.members%rowtype;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into m from public.members where id = p_member for update;
  if not found or not private.has_branch_role(m.club_id, m.branch_id, array['owner','branch_manager']::public.staff_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.mfa_ok(m.club_id) then raise exception 'MFA required' using errcode = '42501'; end if;
  delete from public.push_subscriptions where user_id = m.user_id;
  delete from public.member_notes where member_id = p_member;
  update public.members set full_name = 'عضو محذوف #' || member_no, phone = null, email = null, birth_date = null,
         user_id = null, status = 'cancelled' where id = p_member;
  update public.memberships set status = 'cancelled' where member_id = p_member and status in ('active','paused');
  update public.data_requests set done_at = now() where member_id = p_member and done_at is null;
  perform private.write_audit(m.club_id, 'access', 'member_anonymized', p_member, '{}'::jsonb);
end; $function$;
drop function if exists public.pin_tap(uuid, integer, text, bigint, text);
drop function if exists public.my_pin_status();
drop function if exists public.set_member_pin(text);
drop table if exists public.member_pins;
