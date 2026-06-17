alter table public.companies
  add column if not exists customer_health text not null default 'healthy',
  add column if not exists usage_level text not null default 'unknown',
  add column if not exists renewal_risk text not null default 'low',
  add column if not exists last_success_checkin date,
  add column if not exists next_follow_up_date date,
  add column if not exists customer_success_notes text,
  add column if not exists success_updated_at timestamp with time zone;

alter table public.companies
  drop constraint if exists companies_customer_health_check;

alter table public.companies
  add constraint companies_customer_health_check
  check (customer_health in ('healthy', 'watch', 'at_risk'));

alter table public.companies
  drop constraint if exists companies_usage_level_check;

alter table public.companies
  add constraint companies_usage_level_check
  check (usage_level in ('unknown', 'low', 'medium', 'high'));

alter table public.companies
  drop constraint if exists companies_renewal_risk_check;

alter table public.companies
  add constraint companies_renewal_risk_check
  check (renewal_risk in ('low', 'medium', 'high'));

update public.companies
set
  customer_health = coalesce(customer_health, 'healthy'),
  usage_level = coalesce(usage_level, 'unknown'),
  renewal_risk = coalesce(renewal_risk, 'low');
