-- HyperRoute Intelligence
-- Self-service company signup function.
--
-- This creates the company, subscription, and first company owner for the
-- currently logged-in Supabase Auth user. It avoids exposing service-role keys
-- in the browser.

create or replace function public.create_self_service_company(
  company_name_input text,
  legal_name_input text,
  phone_input text,
  email_input text,
  plan_name_input text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_company_id uuid;
  selected_plan text;
  selected_price numeric;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in to create a company.';
  end if;

  selected_plan := lower(coalesce(plan_name_input, 'professional'));

  if selected_plan not in ('starter', 'professional', 'business', 'enterprise') then
    raise exception 'Invalid plan selected.';
  end if;

  selected_price := case selected_plan
    when 'starter' then 99
    when 'professional' then 199
    when 'business' then 399
    else 0
  end;

  insert into public.companies (
    company_name,
    legal_name,
    phone,
    email,
    status
  )
  values (
    company_name_input,
    nullif(legal_name_input, ''),
    nullif(phone_input, ''),
    nullif(email_input, ''),
    'active'
  )
  returning id into new_company_id;

  insert into public.company_subscriptions (
    company_id,
    plan_name,
    monthly_price,
    billing_status,
    trial_ends_at,
    renews_at
  )
  values (
    new_company_id,
    selected_plan,
    selected_price,
    'trial',
    current_date + 14,
    current_date + 14
  )
  on conflict (company_id)
  do update set
    plan_name = excluded.plan_name,
    monthly_price = excluded.monthly_price,
    billing_status = excluded.billing_status,
    trial_ends_at = excluded.trial_ends_at,
    renews_at = excluded.renews_at,
    updated_at = now();

  insert into public.company_users (
    company_id,
    user_id,
    role,
    status
  )
  values (
    new_company_id,
    auth.uid(),
    'company_owner',
    'active'
  )
  on conflict (company_id, user_id)
  do update set
    role = 'company_owner',
    status = 'active';

  insert into public.activity_logs (
    company_id,
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    description,
    metadata
  )
  values (
    new_company_id,
    auth.uid(),
    'company_owner',
    'create',
    'company',
    new_company_id::text,
    'Created company through self-service signup.',
    jsonb_build_object('plan_name', selected_plan, 'monthly_price', selected_price)
  );

  return new_company_id;
end;
$$;

grant execute on function public.create_self_service_company(text, text, text, text, text)
to authenticated;
