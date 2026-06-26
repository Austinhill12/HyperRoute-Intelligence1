create extension if not exists pgcrypto;

alter table public.companies enable row level security;
alter table public.company_users enable row level security;

-- Remove bad unique constraints on company_users that limit one user to one company.
do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'company_users'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) ilike '%user_id%'
      and pg_get_constraintdef(con.oid) not ilike '%company_id%'
  loop
    execute format(
      'alter table public.company_users drop constraint if exists %I',
      constraint_record.conname
    );
  end loop;
end $$;

-- Remove bad unique indexes on user_id only.
do $$
declare
  index_record record;
begin
  for index_record in
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'company_users'
      and indexdef ilike '%unique%'
      and indexdef ilike '%user_id%'
      and indexdef not ilike '%company_id%'
  loop
    execute format('drop index if exists public.%I', index_record.indexname);
  end loop;
end $$;

-- Correct uniqueness: same user can belong to many companies,
-- but cannot be duplicated inside the same company.
create unique index if not exists company_users_company_user_unique
on public.company_users(company_id, user_id);

-- Companies can have the same public name. Different customers may use similar names.
do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'companies'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) ilike '%company_name%'
  loop
    execute format(
      'alter table public.companies drop constraint if exists %I',
      constraint_record.conname
    );
  end loop;
end $$;

do $$
declare
  index_record record;
begin
  for index_record in
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'companies'
      and indexdef ilike '%unique%'
      and indexdef ilike '%company_name%'
  loop
    execute format('drop index if exists public.%I', index_record.indexname);
  end loop;
end $$;

-- Make required account columns exist.
alter table public.companies
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists operation_type text default 'carrier',
  add column if not exists account_type text default 'customer',
  add column if not exists lifecycle_stage text default 'trial',
  add column if not exists lifecycle_updated_at timestamp with time zone default now(),
  add column if not exists updated_at timestamp with time zone default now();

alter table public.company_subscriptions
  add column if not exists monthly_price numeric default 0,
  add column if not exists billing_status text default 'trial',
  add column if not exists trial_ends_at date,
  add column if not exists renews_at date,
  add column if not exists payment_setup_status text default 'not_started',
  add column if not exists billing_email text,
  add column if not exists payment_provider text default 'manual',
  add column if not exists notes text,
  add column if not exists updated_at timestamp with time zone default now();

-- Safe company read policy: platform admins see all; normal users see only memberships.
drop policy if exists companies_member_read on public.companies;
drop policy if exists companies_platform_read on public.companies;

create policy companies_member_read
on public.companies
for select
to authenticated
using (
  public.user_is_platform_admin()
  or exists (
    select 1
    from public.company_users cu
    where cu.company_id = companies.id
      and cu.user_id = auth.uid()
      and lower(coalesce(cu.status, '')) = 'active'
  )
);

-- Allow signed-in users to create a company row.
drop policy if exists companies_authenticated_insert on public.companies;
drop policy if exists company_admin_insert_companies on public.companies;

create policy companies_authenticated_insert
on public.companies
for insert
to authenticated
with check (true);

-- Allow admins/owners to update their company.
drop policy if exists companies_admin_update on public.companies;
drop policy if exists company_admin_update_companies on public.companies;

create policy companies_admin_update
on public.companies
for update
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(id)
)
with check (
  public.user_is_platform_admin()
  or public.user_is_company_admin(id)
);

-- Company user policies.
drop policy if exists company_users_read on public.company_users;
drop policy if exists company_users_insert_self_owner on public.company_users;
drop policy if exists company_users_insert_admin on public.company_users;
drop policy if exists company_users_update_admin on public.company_users;
drop policy if exists company_users_delete_admin on public.company_users;

create policy company_users_read
on public.company_users
for select
to authenticated
using (
  public.user_is_platform_admin()
  or user_id = auth.uid()
  or public.user_is_company_admin(company_id)
);

create policy company_users_insert_self_owner
on public.company_users
for insert
to authenticated
with check (
  user_id = auth.uid()
  and lower(coalesce(role, '')) in ('owner', 'company_owner')
  and lower(coalesce(status, '')) = 'active'
);

create policy company_users_insert_admin
on public.company_users
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);

create policy company_users_update_admin
on public.company_users
for update
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
)
with check (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);

create policy company_users_delete_admin
on public.company_users
for delete
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);

drop function if exists public.create_self_service_company(text, text, text, text, text);
drop function if exists public.create_self_service_company(text, text, text, text, text, text);

create or replace function public.create_self_service_company(
  company_name_input text,
  legal_name_input text default null,
  phone_input text default null,
  email_input text default null,
  plan_name_input text default 'carrier_medium',
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
  selected_operation text;
  selected_plan text;
  selected_price numeric;
  trial_end date := current_date + interval '14 days';
begin
  if current_user_id is null then
    raise exception 'You must be logged in to create a HyperRoute workspace.';
  end if;

  if nullif(trim(company_name_input), '') is null then
    raise exception 'Company name is required.';
  end if;

  selected_operation := case
    when operation_type_input in ('carrier', 'dispatcher', 'broker_3pl', 'hybrid') then operation_type_input
    else 'carrier'
  end;

  selected_plan := case
    when plan_name_input in (
      'dispatcher_small', 'dispatcher_medium', 'dispatcher_large', 'dispatcher_unlimited',
      'carrier_small', 'carrier_medium', 'carrier_large', 'carrier_unlimited',
      'broker_3pl_small', 'broker_3pl_medium', 'broker_3pl_large', 'broker_3pl_unlimited',
      'hybrid_small', 'hybrid_medium', 'hybrid_large', 'hybrid_unlimited',
      'starter', 'professional', 'business', 'enterprise'
    ) then plan_name_input
    else selected_operation || '_medium'
  end;

  selected_price := case selected_plan
    when 'dispatcher_small' then 49
    when 'dispatcher_medium' then 99
    when 'dispatcher_large' then 149
    when 'dispatcher_unlimited' then 249
    when 'carrier_small' then 99
    when 'carrier_medium' then 199
    when 'carrier_large' then 349
    when 'carrier_unlimited' then 599
    when 'broker_3pl_small' then 99
    when 'broker_3pl_medium' then 249
    when 'broker_3pl_large' then 499
    when 'broker_3pl_unlimited' then 799
    when 'hybrid_small' then 149
    when 'hybrid_medium' then 299
    when 'hybrid_large' then 599
    when 'hybrid_unlimited' then 999
    when 'starter' then 99
    when 'professional' then 199
    when 'business' then 399
    else 0
  end;

  -- Prevent accidental duplicate workspaces for the same user and same company name,
  -- while still allowing unlimited different companies.
  select c.id
    into created_company_id
  from public.company_users cu
  join public.companies c on c.id = cu.company_id
  where cu.user_id = current_user_id
    and lower(c.company_name) = lower(trim(company_name_input))
    and lower(coalesce(c.status, 'active')) <> 'deleted'
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
  on conflict (company_id, user_id)
  do update set
    role = excluded.role,
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
  on conflict (company_id)
  do update set
    plan_name = excluded.plan_name,
    monthly_price = excluded.monthly_price,
    billing_status = excluded.billing_status,
    trial_ends_at = excluded.trial_ends_at,
    renews_at = excluded.renews_at,
    payment_setup_status = coalesce(public.company_subscriptions.payment_setup_status, excluded.payment_setup_status),
    billing_email = coalesce(public.company_subscriptions.billing_email, excluded.billing_email),
    payment_provider = coalesce(public.company_subscriptions.payment_provider, excluded.payment_provider),
    notes = excluded.notes,
    updated_at = now();

  return created_company_id;
end;
$$;

grant execute on function public.create_self_service_company(text, text, text, text, text, text)
to authenticated;

select
  'self service company creation ready' as status,
  count(*) as total_companies
from public.companies;
