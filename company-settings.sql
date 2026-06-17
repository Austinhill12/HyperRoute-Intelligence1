create table if not exists public.company_settings (
  id bigint primary key default 1,
  company_name text not null default 'HyperRoute Intelligence',
  phone text,
  email text,
  website text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  zip text,
  mc_number text,
  dot_number text,
  logo_url text,
  invoice_prefix text not null default 'INV-',
  payment_terms_days integer not null default 30,
  default_invoice_notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint company_settings_single_row check (id = 1)
);

alter table public.company_settings enable row level security;

drop policy if exists "allow_read_company_settings" on public.company_settings;
create policy "allow_read_company_settings"
on public.company_settings
for select
to public
using (true);

drop policy if exists "allow_insert_company_settings" on public.company_settings;
create policy "allow_insert_company_settings"
on public.company_settings
for insert
to public
with check (true);

drop policy if exists "allow_update_company_settings" on public.company_settings;
create policy "allow_update_company_settings"
on public.company_settings
for update
to public
using (true)
with check (true);

insert into public.company_settings (
  id,
  company_name,
  invoice_prefix,
  payment_terms_days
)
values (
  1,
  'HyperRoute Intelligence',
  'INV-',
  30
)
on conflict (id) do nothing;
