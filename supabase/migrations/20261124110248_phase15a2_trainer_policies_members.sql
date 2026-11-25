alter policy members_read on public.members using (private.can_read_member(club_id,branch_id,id));
alter policy memberships_read on public.memberships using (private.nontrainer_scope(club_id,branch_id));
