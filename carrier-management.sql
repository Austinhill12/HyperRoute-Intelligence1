create table if not exists public.carriers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  archived_at timestamp with time zone,
  carrier_name text not null,
  mc_number text,
  dot_number text,
  contact_name text,
  phone text,
  email text,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  insurance_provider text,
  insurance_policy_number text,
  insurance_limit numeric,
  insurance_expiration date,
  w9_status text not null default 'missing',
  document_url text,
  safety_rating text,
  factoring_company text,
  payment_terms text,
  preferred_lanes text,
  service_types text,
  last_reviewed_at date,
  status text not null default 'active',
  notes text,
  constraint carriers_status_check check (status in ('active', 'inactive', 'blocked')),
  constraint carriers_w9_status_check check (w9_status in ('missing', 'received', 'verified')),
  constraint carriers_safety_rating_check check (safety_rating is null or safety_rating in ('satisfactory', 'conditional', 'unsatisfactory'))
);

alter table public.carriers
add column if not exists updated_at timestamp with time zone not null default now(),
add column if not exists archived_at timestamp with time zone,
add column if not exists contact_name text,
add column if not exists address_line1 text,
add column if not exists city text,
add column if not exists state text,
add column if not exists postal_code text,
add column if not exists insurance_provider text,
add column if not exists insurance_policy_number text,
add column if not exists insurance_limit numeric,
add column if not exists insurance_expiration date,
add column if not exists w9_status text not null default 'missing',
add column if not exists document_url text,
add column if not exists safety_rating text,
add column if not exists factoring_company text,
add column if not exists payment_terms text,
add column if not exists preferred_lanes text,
add column if not exists service_types text,
add column if not exists last_reviewed_at date;

alter table public.carriers
drop constraint if exists carriers_status_check,
drop constraint if exists carriers_w9_status_check,
drop constraint if exists carriers_safety_rating_check;

alter table public.carriers
add constraint carriers_status_check check (status in ('active', 'inactive', 'blocked')),
add constraint carriers_w9_status_check check (w9_status in ('missing', 'received', 'verified')),
add constraint carriers_safety_rating_check check (safety_rating is null or safety_rating in ('satisfactory', 'conditional', 'unsatisfactory'));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_carriers_updated_at on public.carriers;
create trigger set_carriers_updated_at
before update on public.carriers
for each row
execute function public.set_updated_at();

alter table public.loads
add column if not exists carrier_id uuid references public.carriers(id) on delete set null,
add column if not exists carrier_rate numeric,
add column if not exists margin_amount numeric generated always as (coalesce(rate, 0) - coalesce(carrier_rate, 0)) stored;

create index if not exists carriers_company_id_idx on public.carriers(company_id);
create index if not exists carriers_status_idx on public.carriers(status);
create index if not exists carriers_insurance_expiration_idx on public.carriers(insurance_expiration);
create index if not exists loads_carrier_id_idx on public.loads(carrier_id);

alter table public.carriers enable row level security;

drop policy if exists "carriers_read" on public.carriers;
create policy "carriers_read"
on public.carriers
for select
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "carriers_insert" on public.carriers;
create policy "carriers_insert"
on public.carriers
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "carriers_update" on public.carriers;
create policy "carriers_update"
on public.carriers
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

drop policy if exists "carriers_delete" on public.carriers;
create policy "carriers_delete"
on public.carriers
for delete
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);

grant select, insert, update, delete on public.carriers to authenticated;
