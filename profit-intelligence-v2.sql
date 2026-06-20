-- HyperRoute Profit Intelligence v2 data foundation
-- Run this in Supabase SQL Editor before replacing the v2 load/profit files.

alter table public.loads
  add column if not exists loaded_miles numeric default 0,
  add column if not exists empty_miles numeric default 0,
  add column if not exists fuel_cost numeric default 0,
  add column if not exists toll_cost numeric default 0,
  add column if not exists detention_billed numeric default 0,
  add column if not exists detention_paid numeric default 0,
  add column if not exists lumper_cost numeric default 0,
  add column if not exists accessorial_billed numeric default 0,
  add column if not exists other_costs numeric default 0,
  add column if not exists pod_received_at timestamp with time zone,
  add column if not exists invoice_sent_at timestamp with time zone;

alter table public.invoices
  add column if not exists sent_at timestamp with time zone,
  add column if not exists payment_terms_days integer default 30,
  add column if not exists collection_notes text;

create table if not exists public.load_expenses (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id bigint not null references public.loads(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  expense_date date default current_date,
  category text not null default 'other',
  amount numeric not null default 0,
  billable boolean not null default false,
  reimbursable boolean not null default false,
  paid_by text,
  receipt_url text,
  status text not null default 'unreviewed',
  notes text
);

create index if not exists load_expenses_company_id_idx on public.load_expenses(company_id);
create index if not exists load_expenses_load_id_idx on public.load_expenses(load_id);
create index if not exists load_expenses_category_idx on public.load_expenses(category);

alter table public.load_expenses enable row level security;

drop policy if exists load_expenses_company_read on public.load_expenses;
drop policy if exists load_expenses_company_insert on public.load_expenses;
drop policy if exists load_expenses_company_update on public.load_expenses;
drop policy if exists load_expenses_company_delete on public.load_expenses;

create policy load_expenses_company_read
on public.load_expenses
for select
to authenticated
using (
  user_is_platform_admin()
  or user_has_company_access(company_id)
);

create policy load_expenses_company_insert
on public.load_expenses
for insert
to authenticated
with check (
  company_id is not null
  and (
    user_is_platform_admin()
    or user_has_company_access(company_id)
  )
);

create policy load_expenses_company_update
on public.load_expenses
for update
to authenticated
using (
  user_is_platform_admin()
  or user_is_company_admin(company_id)
)
with check (
  user_is_platform_admin()
  or user_is_company_admin(company_id)
);

create policy load_expenses_company_delete
on public.load_expenses
for delete
to authenticated
using (
  user_is_platform_admin()
  or user_is_company_admin(company_id)
);

comment on table public.load_expenses is 'Itemized load expenses for Profit Intelligence, driver receipt review, and accounting.';
