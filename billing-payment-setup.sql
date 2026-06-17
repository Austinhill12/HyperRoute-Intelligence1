alter table public.company_subscriptions
  add column if not exists payment_setup_status text default 'not_started',
  add column if not exists billing_email text,
  add column if not exists payment_link text,
  add column if not exists payment_provider text default 'manual',
  add column if not exists external_customer_id text,
  add column if not exists external_subscription_id text;

update public.company_subscriptions
set payment_setup_status = 'not_started'
where payment_setup_status is null;

create index if not exists company_subscriptions_payment_setup_idx
  on public.company_subscriptions (payment_setup_status);

create index if not exists company_subscriptions_billing_email_idx
  on public.company_subscriptions (billing_email);
