alter policy checkins_staff_read on public.checkins using (private.nontrainer_scope(club_id,branch_id));
alter policy checkouts_staff_read on public.checkouts using (private.nontrainer_scope(club_id,branch_id));
alter policy registrations_staff_read on public.event_registrations using (private.nontrainer_scope(club_id,branch_id) or private.leads_event(event_id));
alter policy cards_staff_read on public.access_cards using (exists(select 1 from public.members m where m.id=access_cards.member_id and m.club_id=access_cards.club_id and private.nontrainer_scope(m.club_id,m.branch_id)));
