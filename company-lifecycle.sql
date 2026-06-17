-- HyperRoute Intelligence
-- Company lifecycle controls for Platform Admin.
-- Safe to run more than once.

alter table public.companies
add column if not exists account_type text not null default 'customer';

alter table public.companies
add column if not exists archived_at timestamp with time zone;

alter table public.companies
add column if not exists archived_by uuid;

update public.companies
set account_type = 'customer'
where account_type is null;

create index if not exists idx_companies_account_type
on public.companies(account_type);

create index if not exists idx_companies_status
on public.companies(status);

create index if not exists idx_companies_archived_at
on public.companies(archived_at);
