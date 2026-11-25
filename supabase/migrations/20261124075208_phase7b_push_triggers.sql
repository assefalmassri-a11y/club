
create trigger push_on_message_ai after insert on public.messages for each row execute function private.push_on_message();
create trigger push_on_invoice_ai after insert on public.invoices for each row execute function private.push_on_invoice();
create trigger push_on_event_cancel_au after update on public.events for each row execute function private.push_on_event_cancel();
select cron.schedule('push-expiring-memberships', '0 8 * * *', $$select private.push_expiring_memberships()$$);
