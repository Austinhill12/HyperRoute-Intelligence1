alter table public.companies
  add column if not exists lifecycle_stage text default 'trial',
  add column if not exists lifecycle_updated_at timestamp with time zone default now();

alter table public.company_subscriptions
  add column if not exists payment_setup_status text default 'not_started',
  add column if not exists billing_email text,
  add column if not exists payment_link text,
  add column if not exists payment_provider text default 'manual',
  add column if not exists external_customer_id text,
  add column if not exists external_subscription_id text;

drop function if exists public.create_self_service_company(text, text, text, text, text, text);

create or replace function public.create_self_service_company(
  company_name_input text,
  legal_name_input text default null,
  phone_input text default null,
  email_input text default null,
  plan_name_input text default 'professional',
  operation_type_input text default 'carrier'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  created_company_id uuid;
  selected_plan text;
  selected_operation text;
  selected_price numeric;
  trial_end date := current_date + interval '14 days';
begin
  if current_user_id is null then
    raise exception 'You must be logged in to create a HyperRoute workspace.';
  end if;

  if nullif(trim(company_name_input), '') is null then
    raise exception 'Company name is required.';
  end if;

  selected_plan := case
    when plan_name_input in ('starter', 'professional', 'business', 'enterprise') then plan_name_input
    else 'professional'
  end;

  selected_operation := case
    when operation_type_input in ('carrier', 'dispatcher', 'broker_3pl', 'hybrid') then operation_type_input
    else 'carrier'
  end;

  selected_price := case selected_plan
    when 'starter' then 99
    when 'professional' then 199
    when 'business' then 399
    else 0
  end;

  select c.id
    into created_company_id
  from public.company_users cu
  join public.companies c on c.id = cu.company_id
  where cu.user_id = current_user_id
    and lower(c.company_name) = lower(trim(company_name_input))
  order by c.created_at desc
  limit 1;

  if created_company_id is not null then
    return created_company_id;
  end if;

  insert into public.companies (
    company_name,
    legal_name,
    phone,
    email,
    operation_type,
    account_type,
    status,
    lifecycle_stage,
    lifecycle_updated_at,
    handoff_status,
    customer_health,
    created_at,
    updated_at
  )
  values (
    trim(company_name_input),
    nullif(trim(coalesce(legal_name_input, '')), ''),
    nullif(trim(coalesce(phone_input, '')), ''),
    nullif(trim(coalesce(email_input, '')), ''),
    selected_operation,
    'customer',
    'active',
    'trial',
    now(),
    'setup',
    'healthy',
    now(),
    now()
  )
  returning id into created_company_id;

  insert into public.company_users (
    company_id,
    user_id,
    role,
    status,
    created_at
  )
  values (
    created_company_id,
    current_user_id,
    'company_owner',
    'active',
    now()
  )
  on conflict (company_id, user_id) do update
  set role = excluded.role,
      status = 'active';

  insert into public.company_subscriptions (
    company_id,
    plan_name,
    monthly_price,
    billing_status,
    trial_ends_at,
    renews_at,
    payment_setup_status,
    billing_email,
    payment_provider,
    notes,
    created_at,
    updated_at
  )
  values (
    created_company_id,
    selected_plan,
    selected_price,
    'trial',
    trial_end,
    trial_end,
    'not_started',
    nullif(trim(coalesce(email_input, '')), ''),
    'manual',
    'Created from self-service trial signup.',
    now(),
    now()
  )
  on conflict (company_id) do update
  set plan_name = excluded.plan_name,
      monthly_price = excluded.monthly_price,
      billing_status = excluded.billing_status,
      trial_ends_at = excluded.trial_ends_at,
      renews_at = excluded.renews_at,
      payment_setup_status = coalesce(public.company_subscriptions.payment_setup_status, excluded.payment_setup_status),
      billing_email = coalesce(public.company_subscriptions.billing_email, excluded.billing_email),
      payment_provider = coalesce(public.company_subscriptions.payment_provider, excluded.payment_provider),
      notes = excluded.notes,
      updated_at = now();

  begin
    insert into public.activity_logs (
      company_id,
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      description,
      metadata,
      created_at
    )
    values (
      created_company_id,
      current_user_id,
      'company_owner',
      'create',
      'self_service_signup',
      created_company_id::text,
      'Created self-service trial workspace.',
      jsonb_build_object(
        'plan_name', selected_plan,
        'operation_type', selected_operation,
        'lifecycle_stage', 'trial'
      ),
      now()
    );
  exception
    when others then null;
  end;

  return created_company_id;
end;
$$;

grant execute on function public.create_self_service_company(text, text, text, text, text, text) to authenticated;
