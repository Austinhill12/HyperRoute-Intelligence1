-- HyperRoute Intelligence
-- Truck/vehicle access policies for company-safe vehicle creation.
-- Safe to run more than once.

alter table public.trucks
add column if not exists company_id uuid references public.companies(id) on delete set null;

alter table public.trucks enable row level security;

create index if not exists idx_trucks_company_id on public.trucks(company_id);

drop policy if exists "trucks_company_read" on public.trucks;
drop policy if exists "trucks_company_insert" on public.trucks;
drop policy if exists "trucks_company_update" on public.trucks;
drop policy if exists "trucks_company_delete" on public.trucks;

create policy "trucks_company_read"
on public.trucks
for select
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

create policy "trucks_company_insert"
on public.trucks
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

create policy "trucks_company_update"
on public.trucks
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

create policy "trucks_company_delete"
on public.trucks
for delete
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);
