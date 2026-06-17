-- HyperRoute Intelligence
-- Maintenance alert automation support.
-- Safe to run more than once.

alter table public.alerts
add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.alerts
add column if not exists resolved_at timestamp with time zone;

alter table public.alerts
add column if not exists resolved_by uuid;

alter table public.alerts enable row level security;

create index if not exists idx_alerts_company_id on public.alerts(company_id);
create index if not exists idx_alerts_truck_id on public.alerts(truck_id);
create index if not exists idx_alerts_type_resolved on public.alerts(alert_type, resolved);

drop policy if exists "alerts_company_read" on public.alerts;
drop policy if exists "alerts_company_insert" on public.alerts;
drop policy if exists "alerts_company_update" on public.alerts;
drop policy if exists "alerts_company_delete" on public.alerts;

create policy "alerts_company_read"
on public.alerts
for select
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

create policy "alerts_company_insert"
on public.alerts
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

create policy "alerts_company_update"
on public.alerts
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

create policy "alerts_company_delete"
on public.alerts
for delete
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);
