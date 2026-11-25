alter table public.freeze_requests add column kind text not null default 'freeze' check (kind in ('freeze','resume'));

create or replace function public.request_resume(p_member uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare m public.members%rowtype; ms public.memberships%rowtype; rid uuid;
begin
  if not private.real_user() then raise exception 'forbidden' using errcode='42501'; end if;
  select * into m from public.members where id=p_member;
  if not found or not private.is_own_member(m.club_id,m.id) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into ms from public.memberships where member_id=m.id and status='paused' order by ends_on desc limit 1;
  if not found then raise exception 'no_paused_membership'; end if;
  insert into public.freeze_requests(club_id,branch_id,member_id,membership_id,reason,kind)
  values(m.club_id,ms.branch_id,m.id,ms.id,left(nullif(trim(p_reason),''),300),'resume') returning id into rid;
  perform private.write_audit(m.club_id,'freeze','resume_request',m.id,'{}'::jsonb);
  return rid;
exception when unique_violation then raise exception 'already_pending';
end $$;

create or replace function public.decide_freeze(p_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path='' as $$
declare r public.freeze_requests%rowtype;
begin
  select * into r from public.freeze_requests where id=p_id for update;
  if not found or r.status<>'pending' then raise exception 'not_found'; end if;
  if not (private.real_user() and private.has_branch_role(r.club_id,r.branch_id,array['owner','branch_manager','staff']::public.staff_role[])) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if p_approve then
    if r.kind='resume' then
      update public.memberships set status='active' where id=r.membership_id and status='paused';
    else
      update public.memberships set status='paused' where id=r.membership_id and status='active';
    end if;
  end if;
  update public.freeze_requests set status=case when p_approve then 'approved' else 'rejected' end, decided_by=auth.uid(), decided_at=now() where id=p_id;
  perform private.write_audit(r.club_id,'freeze',case when p_approve then 'approve' else 'reject' end,r.member_id,jsonb_build_object('kind',r.kind));
end $$;
revoke all on function public.request_resume from public,anon;
grant execute on function public.request_resume to authenticated;
