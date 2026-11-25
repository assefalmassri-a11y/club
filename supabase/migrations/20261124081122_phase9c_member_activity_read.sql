create policy door_attempts_self_member_read on public.door_attempts for select to authenticated
  using (member_id is not null and private.is_own_member(club_id, member_id));
