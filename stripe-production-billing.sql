alter table public.company_subscriptions
  add column if not exists payment_setup_status text default 'not_started',
  add column if not exists billing_email text,
  add column if not exists payment_link text,
  add column if not exists payment_provider text default 'manual',
  add column if not exists external_customer_id text,
  add column if not exists external_subscription_id text,
  add column if not exists checkout_session_id text,
  add column if not exists last_payment_error text;

update public.company_subscriptions
set payment_setup_status = coalesce(payment_setup_status, 'not_started'),
    payment_provider = coalesce(payment_provider, 'manual');

alter table public.company_subscriptions
  drop constraint if exists company_subscriptions_billing_status_check;

alter table public.company_subscriptions
  add constraint company_subscriptions_billing_status_check
  check (billing_status in ('trial', 'checkout_pending', 'active', 'past_due', 'suspended', 'canceled'));

alter table public.company_subscriptions
  drop constraint if exists company_subscriptions_payment_setup_status_check;

alter table public.company_subscriptions
  add constraint company_subscriptions_payment_setup_status_check
  check (payment_setup_status in ('not_started', 'payment_link_sent', 'payment_method_on_file', 'auto_billing_ready'));

create index if not exists company_subscriptions_external_customer_idx
  on public.company_subscriptions (external_customer_id);

create index if not exists company_subscriptions_external_subscription_idx
  on public.company_subscriptions (external_subscription_id);

create index if not exists company_subscriptions_checkout_session_idx
  on public.company_subscriptions (checkout_session_id);

create index if not exists company_subscriptions_billing_status_idx
  on public.company_subscriptions (billing_status);
