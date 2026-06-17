-- HyperRoute Intelligence
-- Update subscription pricing options/defaults.

alter table public.company_subscriptions
alter column plan_name set default 'professional';

alter table public.company_subscriptions
alter column monthly_price set default 199;

update public.company_subscriptions
set
  plan_name = 'professional',
  monthly_price = 199,
  updated_at = now()
where plan_name = 'starter'
  and coalesce(monthly_price, 0) = 0;

update public.company_subscriptions
set monthly_price = 99, updated_at = now()
where plan_name = 'starter'
  and coalesce(monthly_price, 0) = 0;

update public.company_subscriptions
set monthly_price = 199, updated_at = now()
where plan_name = 'professional'
  and coalesce(monthly_price, 0) = 0;

update public.company_subscriptions
set monthly_price = 399, updated_at = now()
where plan_name = 'business'
  and coalesce(monthly_price, 0) = 0;
