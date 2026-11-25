alter table public.audit_log drop constraint audit_log_domain_check;
alter table public.audit_log add constraint audit_log_domain_check check (domain = any (array['finance','access','events','attendance','fx','payroll','freeze','plan']));
