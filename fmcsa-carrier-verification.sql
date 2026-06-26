alter table public.carriers
add column if not exists fmcsa_verification_status text not null default 'not_checked',
add column if not exists fmcsa_checked_at timestamp with time zone,
add column if not exists fmcsa_operating_status text,
add column if not exists fmcsa_authority_status text,
add column if not exists fmcsa_safety_rating text,
add column if not exists fmcsa_snapshot jsonb not null default '{}'::jsonb;

alter table public.carriers
drop constraint if exists carriers_fmcsa_verification_status_check;

alter table public.carriers
add constraint carriers_fmcsa_verification_status_check
check (fmcsa_verification_status in ('not_checked', 'verified', 'needs_review', 'blocked', 'inactive', 'out_of_service'));

create table if not exists public.fmcsa_carrier_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  checked_by uuid default auth.uid(),
  dot_number text,
  mc_number text,
  verification_status text not null default 'needs_review',
  operating_status text,
  authority_status text,
  safety_rating text,
  source text not null default 'profile_review',
  notes text,
  raw_response jsonb not null default '{}'::jsonb,
  constraint fmcsa_carrier_checks_status_check check (verification_status in ('not_checked', 'verified', 'needs_review', 'blocked', 'inactive', 'out_of_service'))
);

create index if not exists carriers_fmcsa_status_idx on public.carriers(fmcsa_verification_status);
create index if not exists carriers_fmcsa_checked_at_idx on public.carriers(fmcsa_checked_at);
create index if not exists fmcsa_carrier_checks_company_id_idx on public.fmcsa_carrier_checks(company_id);
create index if not exists fmcsa_carrier_checks_carrier_id_idx on public.fmcsa_carrier_checks(carrier_id);
create index if not exists fmcsa_carrier_checks_created_at_idx on public.fmcsa_carrier_checks(created_at desc);

alter table public.fmcsa_carrier_checks enable row level security;

drop policy if exists "fmcsa_carrier_checks_read" on public.fmcsa_carrier_checks;
create policy "fmcsa_carrier_checks_read"
on public.fmcsa_carrier_checks
for select
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "fmcsa_carrier_checks_insert" on public.fmcsa_carrier_checks;
create policy "fmcsa_carrier_checks_insert"
on public.fmcsa_carrier_checks
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "fmcsa_carrier_checks_update" on public.fmcsa_carrier_checks;
create policy "fmcsa_carrier_checks_update"
on public.fmcsa_carrier_checks
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

drop policy if exists "fmcsa_carrier_checks_delete" on public.fmcsa_carrier_checks;
create policy "fmcsa_carrier_checks_delete"
on public.fmcsa_carrier_checks
for delete
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);

grant select, insert, update, delete on public.fmcsa_carrier_checks to authenticated;

select
  'fmcsa carrier verification ready' as status,
  count(*) as carrier_count
from public.carriers;
