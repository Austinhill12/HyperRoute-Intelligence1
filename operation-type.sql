alter table public.companies
add column if not exists operation_type text not null default 'carrier';

alter table public.companies
drop constraint if exists companies_operation_type_check;

alter table public.companies
add constraint companies_operation_type_check
check (operation_type in ('carrier', 'dispatcher', 'broker_3pl', 'hybrid'));

update public.companies
set operation_type = 'carrier'
where operation_type is null;

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
as $$
declare
  new_company_id uuid;
  selected_plan text;
  selected_operation_type text;
  selected_price numeric;
begin
  selected_plan := coalesce(nullif(plan_name_input, ''), 'professional');
  selected_operation_type := coalesce(nullif(operation_type_input, ''), 'carrier');

  if selected_operation_type not in ('carrier', 'dispatcher', 'broker_3pl', 'hybrid') then
    selected_operation_type := 'carrier';
  end if;

  selected_price := case selected_plan
    when 'starter' then 99
    when 'business' then 399
    when 'enterprise' then 0
    else 199
  end;

  insert into public.companies (
    company_name, legal_name, phone, email, status, account_type, operation_type
  )
  values (
    company_name_input, legal_name_input, phone_input, email_input, 'active', 'customer', selected_operation_type
  )
  returning id into new_company_id;

  insert into public.company_users (company_id, user_id, role, status)
  values (new_company_id, auth.uid(), 'company_owner', 'active');

  insert into public.company_subscriptions (
    company_id, plan_name, monthly_price, billing_status, trial_ends_at, renews_at
  )
  values (
    new_company_id, selected_plan, selected_price, 'trial', current_date + interval '14 days', current_date + interval '14 days'
  );

  return new_company_id;
end;
$$;

grant execute on function public.create_self_service_company(text, text, text, text, text, text) to authenticated;
