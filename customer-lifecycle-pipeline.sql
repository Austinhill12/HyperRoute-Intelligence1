alter table public.companies
  add column if not exists lifecycle_stage text default 'trial',
  add column if not exists lifecycle_updated_at timestamp with time zone default now();

update public.companies
set lifecycle_stage = case
  when status = 'archived' then 'canceled'
  when customer_health = 'at_risk' then 'at_risk'
  when handoff_status = 'live' then 'live'
  when handoff_status = 'training' then 'onboarding'
  when account_type = 'demo' then 'trial'
  else coalesce(lifecycle_stage, 'trial')
end
where lifecycle_stage is null
   or lifecycle_stage not in ('lead', 'trial', 'onboarding', 'live', 'at_risk', 'canceled');

alter table public.companies
  drop constraint if exists companies_lifecycle_stage_check;

alter table public.companies
  add constraint companies_lifecycle_stage_check
  check (lifecycle_stage in ('lead', 'trial', 'onboarding', 'live', 'at_risk', 'canceled'));

create index if not exists companies_lifecycle_stage_idx
  on public.companies (lifecycle_stage);

create index if not exists companies_lifecycle_updated_idx
  on public.companies (lifecycle_updated_at);
