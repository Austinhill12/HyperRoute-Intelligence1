alter table public.companies
  add column if not exists handoff_status text not null default 'setup',
  add column if not exists onboarding_notes text,
  add column if not exists last_customer_contact date,
  add column if not exists go_live_date date,
  add column if not exists handoff_updated_at timestamp with time zone;

alter table public.companies
  drop constraint if exists companies_handoff_status_check;

alter table public.companies
  add constraint companies_handoff_status_check
  check (handoff_status in ('setup', 'training', 'live', 'needs_attention'));

update public.companies
set handoff_status = 'setup'
where handoff_status is null;
