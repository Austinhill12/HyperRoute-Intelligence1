create extension if not exists pgcrypto;

create table if not exists public.api_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  provider text not null,
  display_name text not null,
  category text not null default 'custom',
  status text not null default 'not_connected',
  sync_direction text not null default 'both',
  base_url text,
  external_account_id text,
  last_sync_at timestamp with time zone,
  last_error text,
  notes text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.integration_events (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid references public.api_connections(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  provider text,
  event_type text not null default 'sync',
  status text not null default 'info',
  direction text,
  message text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_api_connections_company_id on public.api_connections(company_id);
create index if not exists idx_api_connections_provider on public.api_connections(provider);
create index if not exists idx_api_connections_status on public.api_connections(status);
create index if not exists idx_integration_events_company_id on public.integration_events(company_id);
create index if not exists idx_integration_events_connection_id on public.integration_events(connection_id);
create index if not exists idx_integration_events_created_at on public.integration_events(created_at desc);

alter table public.api_connections enable row level security;
alter table public.integration_events enable row level security;

create or replace function public.user_can_manage_company_integrations(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_is_platform_admin()
    or public.user_is_company_admin(target_company_id)
    or exists (
      select 1
      from public.company_users cu
      where cu.company_id = target_company_id
        and cu.user_id = auth.uid()
        and lower(coalesce(cu.status, '')) = 'active'
        and lower(coalesce(cu.role, '')) in (
          'owner',
          'company_owner',
          'admin',
          'company_admin',
          'dispatcher',
          'accounting'
        )
    );
$$;

drop policy if exists api_connections_company_read on public.api_connections;
drop policy if exists api_connections_company_insert on public.api_connections;
drop policy if exists api_connections_company_update on public.api_connections;
drop policy if exists api_connections_company_delete on public.api_connections;

create policy api_connections_company_read
on public.api_connections
for select
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_has_company_access(company_id)
);

create policy api_connections_company_insert
on public.api_connections
for insert
to authenticated
with check (
  company_id is not null
  and public.user_can_manage_company_integrations(company_id)
);

create policy api_connections_company_update
on public.api_connections
for update
to authenticated
using (
  public.user_can_manage_company_integrations(company_id)
)
with check (
  public.user_can_manage_company_integrations(company_id)
);

create policy api_connections_company_delete
on public.api_connections
for delete
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);

drop policy if exists integration_events_company_read on public.integration_events;
drop policy if exists integration_events_company_insert on public.integration_events;
drop policy if exists integration_events_company_update on public.integration_events;
drop policy if exists integration_events_company_delete on public.integration_events;

create policy integration_events_company_read
on public.integration_events
for select
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_has_company_access(company_id)
);

create policy integration_events_company_insert
on public.integration_events
for insert
to authenticated
with check (
  company_id is not null
  and public.user_can_manage_company_integrations(company_id)
);

create policy integration_events_company_update
on public.integration_events
for update
to authenticated
using (
  public.user_can_manage_company_integrations(company_id)
)
with check (
  public.user_can_manage_company_integrations(company_id)
);

create policy integration_events_company_delete
on public.integration_events
for delete
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);

select
  'integration hub ready' as status,
  count(*) filter (where table_name = 'api_connections') as api_connections_table,
  count(*) filter (where table_name = 'integration_events') as integration_events_table
from information_schema.tables
where table_schema = 'public'
  and table_name in ('api_connections', 'integration_events');
