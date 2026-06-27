-- HyperRoute Intelligence
-- Rate Con Import foundation.
-- Safe to run more than once in Supabase SQL Editor.

alter table public.loads
add column if not exists broker_name text,
add column if not exists broker_contact text,
add column if not exists broker_mc_number text,
add column if not exists rate_confirmation_number text,
add column if not exists customer_reference_number text,
add column if not exists fuel_surcharge numeric,
add column if not exists accessorial_pay numeric,
add column if not exists equipment_requirements text,
add column if not exists hazmat_required boolean not null default false,
add column if not exists temperature_requirements text,
add column if not exists tracking_required boolean not null default false,
add column if not exists required_documents text,
add column if not exists lumper_information text,
add column if not exists detention_policy text,
add column if not exists import_source text,
add column if not exists rate_con_import_id uuid;

create table if not exists public.rate_con_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id bigint references public.loads(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone,
  created_by uuid default auth.uid(),
  file_name text not null,
  file_size bigint,
  mime_type text,
  status text not null default 'review',
  confidence_score integer not null default 0,
  extracted_text text,
  extracted_data jsonb not null default '{}'::jsonb,
  reviewed_data jsonb not null default '{}'::jsonb,
  notes text,
  constraint rate_con_imports_status_check check (status in ('review', 'load_created', 'cancelled', 'failed')),
  constraint rate_con_imports_confidence_score_check check (confidence_score between 0 and 100)
);

alter table public.loads
drop constraint if exists loads_rate_con_import_id_fkey;

alter table public.loads
add constraint loads_rate_con_import_id_fkey
foreign key (rate_con_import_id)
references public.rate_con_imports(id)
on delete set null;

create index if not exists idx_loads_rate_confirmation_number on public.loads(company_id, rate_confirmation_number);
create index if not exists idx_loads_customer_reference_number on public.loads(company_id, customer_reference_number);
create index if not exists idx_loads_import_source on public.loads(company_id, import_source);
create index if not exists idx_rate_con_imports_company_id on public.rate_con_imports(company_id);
create index if not exists idx_rate_con_imports_status on public.rate_con_imports(company_id, status);
create index if not exists idx_rate_con_imports_created_at on public.rate_con_imports(created_at desc);

alter table public.rate_con_imports enable row level security;

drop policy if exists "rate_con_imports_company_read" on public.rate_con_imports;
drop policy if exists "rate_con_imports_company_insert" on public.rate_con_imports;
drop policy if exists "rate_con_imports_company_update" on public.rate_con_imports;
drop policy if exists "rate_con_imports_company_delete" on public.rate_con_imports;

create policy "rate_con_imports_company_read"
on public.rate_con_imports
for select
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

create policy "rate_con_imports_company_insert"
on public.rate_con_imports
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

create policy "rate_con_imports_company_update"
on public.rate_con_imports
for update
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
)
with check (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

create policy "rate_con_imports_company_delete"
on public.rate_con_imports
for delete
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);

grant select, insert, update, delete on public.rate_con_imports to authenticated;

select
  'rate con import ready' as status,
  count(*) as existing_imports
from public.rate_con_imports;
