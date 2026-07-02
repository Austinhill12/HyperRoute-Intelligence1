create extension if not exists pgcrypto;

create table if not exists public.integration_providers (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null unique,
  display_name text not null,
  category text not null,
  description text,
  setup_status text not null default 'planned',
  recommended_order integer not null default 100,
  docs_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.company_integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  display_name text not null,
  category text not null default 'custom',
  status text not null default 'not_connected',
  sync_direction text not null default 'both',
  environment text not null default 'production',
  base_url text,
  external_account_id text,
  last_sync_at timestamp with time zone,
  last_error text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.integration_sync_logs (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  integration_id uuid references public.company_integrations(id) on delete set null,
  provider text,
  sync_type text not null default 'manual',
  status text not null default 'queued',
  started_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone,
  records_received integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  error_message text,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.integration_events (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  integration_id uuid references public.company_integrations(id) on delete set null,
  connection_id uuid,
  created_at timestamp with time zone not null default now(),
  provider text,
  event_type text not null default 'sync',
  status text not null default 'info',
  direction text,
  message text,
  payload jsonb not null default '{}'::jsonb
);

-- Backward-compatible table used by older HyperRoute files.
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

-- Truck routing
create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id bigint references public.loads(id) on delete set null,
  provider text,
  route_name text,
  origin text,
  destination text,
  distance_miles numeric,
  eta_minutes integer,
  toll_cost numeric,
  status text not null default 'planned',
  truck_specs jsonb not null default '{}'::jsonb,
  route_summary jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.route_segments (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid references public.routes(id) on delete cascade,
  sequence_number integer not null default 1,
  instruction text,
  distance_miles numeric,
  duration_minutes integer,
  geometry jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.route_restrictions (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid references public.routes(id) on delete cascade,
  restriction_type text not null,
  severity text not null default 'info',
  description text,
  location text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.toll_costs (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid references public.routes(id) on delete cascade,
  toll_name text,
  amount numeric,
  currency text not null default 'USD',
  location text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

-- Fuel optimization
create table if not exists public.fuel_stations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  provider text,
  station_name text not null,
  brand text,
  address text,
  city text,
  state text,
  latitude numeric,
  longitude numeric,
  truck_friendly boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.fuel_prices (
  id bigserial primary key,
  company_id uuid references public.companies(id) on delete cascade,
  station_id uuid references public.fuel_stations(id) on delete cascade,
  fuel_type text not null default 'diesel',
  price numeric,
  price_time timestamp with time zone not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.fuel_discounts (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid references public.fuel_stations(id) on delete set null,
  route_id uuid references public.routes(id) on delete set null,
  discount_amount numeric,
  discount_type text,
  recommended_stop boolean not null default false,
  distance_from_route_miles numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

-- Telematics
create table if not exists public.vehicle_locations (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  truck_id bigint,
  driver_id bigint,
  provider text,
  latitude numeric,
  longitude numeric,
  speed_mph numeric,
  heading numeric,
  location_time timestamp with time zone not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.driver_status (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id bigint,
  provider text,
  duty_status text,
  hours_remaining numeric,
  status_time timestamp with time zone not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.engine_faults (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  truck_id bigint,
  provider text,
  fault_code text,
  severity text not null default 'warning',
  description text,
  fault_time timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.vehicle_health (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  truck_id bigint,
  provider text,
  health_score numeric,
  odometer_miles numeric,
  engine_hours numeric,
  last_update_time timestamp with time zone not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

-- Load boards
create table if not exists public.brokers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  broker_name text not null,
  mc_number text,
  dot_number text,
  contact_name text,
  phone text,
  email text,
  rating numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.load_rates (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id bigint references public.loads(id) on delete set null,
  provider text,
  lane text,
  rate numeric,
  rate_per_mile numeric,
  miles numeric,
  equipment_type text,
  pickup_location text,
  delivery_location text,
  observed_at timestamp with time zone not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

-- Weather and risk
create table if not exists public.weather_alerts (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid references public.routes(id) on delete set null,
  provider text,
  alert_type text,
  severity text not null default 'warning',
  location text,
  message text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.risk_scores (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid references public.routes(id) on delete set null,
  load_id bigint references public.loads(id) on delete set null,
  risk_type text not null,
  score numeric not null default 0,
  reason text,
  recommendation text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

-- Maintenance and diagnostics
create table if not exists public.maintenance_alerts (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  truck_id bigint,
  provider text,
  alert_type text,
  severity text not null default 'warning',
  message text,
  due_date date,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.fault_codes (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  truck_id bigint,
  code text not null,
  code_description text,
  severity text not null default 'warning',
  source text,
  detected_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.repair_recommendations (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  truck_id bigint,
  fault_code_id bigint references public.fault_codes(id) on delete set null,
  recommendation text,
  estimated_cost numeric,
  nearest_shop text,
  priority text not null default 'normal',
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

-- Compliance and FMCSA
create table if not exists public.carrier_scores (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  carrier_name text,
  mc_number text,
  dot_number text,
  safety_rating text,
  authority_status text,
  risk_score numeric,
  provider text not null default 'fmcsa',
  checked_at timestamp with time zone not null default now(),
  raw_response jsonb not null default '{}'::jsonb
);

create table if not exists public.driver_violations (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id bigint,
  provider text,
  violation_type text,
  severity text not null default 'warning',
  description text,
  violation_date date,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hos_logs (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id bigint,
  provider text,
  duty_status text,
  hours_remaining numeric,
  cycle_hours_remaining numeric,
  log_time timestamp with time zone not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

insert into public.integration_providers (provider_key, display_name, category, description, setup_status, recommended_order)
values
  ('fmcsa', 'FMCSA Carrier Verification', 'compliance', 'Authority, safety rating, DOT/MC status, and tendering risk checks.', 'ready', 1),
  ('here_truck_routing', 'HERE Truck Routing', 'routing', 'Truck-legal route, ETA, distance, tolls, hazmat restrictions, and bridge warnings.', 'planned', 2),
  ('trimble_maps', 'PC*Miler / Trimble Maps', 'routing', 'Commercial mileage, truck restrictions, tolls, and routing intelligence.', 'planned', 3),
  ('mapbox_truck_routing', 'Mapbox Truck Routing', 'routing', 'Truck route planning and map visualization.', 'planned', 4),
  ('openfuel', 'OpenFuel', 'fuel', 'Route-based fuel prices, discounts, and recommended fuel stops.', 'planned', 5),
  ('pilot_flying_j', 'Pilot / Flying J', 'fuel', 'Fuel network pricing and stop intelligence.', 'planned', 6),
  ('loves', 'Love''s', 'fuel', 'Fuel network pricing and stop intelligence.', 'planned', 7),
  ('samsara', 'Samsara', 'telematics', 'GPS, HOS, vehicle health, driver status, and fault code visibility.', 'planned', 8),
  ('motive', 'Motive', 'telematics', 'ELD, GPS, HOS, engine health, and safety data.', 'planned', 9),
  ('geotab', 'Geotab', 'telematics', 'Telematics, GPS, engine diagnostics, and vehicle health.', 'planned', 10),
  ('dat', 'DAT Load Board', 'load_board', 'Available loads, broker details, rate intelligence, and market demand.', 'planned', 11),
  ('truckstop', 'Truckstop Load Board', 'load_board', 'Load opportunities, broker details, and rate intelligence.', 'planned', 12),
  ('tomorrow_io', 'Tomorrow.io Weather', 'weather', 'Weather, wind, storm, and route risk intelligence.', 'planned', 13),
  ('noaa', 'NOAA Weather', 'weather', 'Weather alerts and public risk data.', 'planned', 14),
  ('noregon', 'Noregon Diagnostics', 'diagnostics', 'Fault codes, severity, and repair guidance.', 'planned', 15),
  ('diesel_laptops', 'Diesel Laptops', 'diagnostics', 'Diagnostics, fault codes, and repair recommendations.', 'planned', 16)
on conflict (provider_key) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  description = excluded.description,
  setup_status = excluded.setup_status,
  recommended_order = excluded.recommended_order,
  updated_at = now();

create index if not exists idx_integration_providers_key on public.integration_providers(provider_key);
create index if not exists idx_company_integrations_company_id on public.company_integrations(company_id);
create index if not exists idx_company_integrations_provider on public.company_integrations(provider);
create index if not exists idx_company_integrations_status on public.company_integrations(status);
create index if not exists idx_integration_sync_logs_company_id on public.integration_sync_logs(company_id);
create index if not exists idx_integration_events_company_id on public.integration_events(company_id);
create index if not exists idx_integration_events_integration_id on public.integration_events(integration_id);
create index if not exists idx_integration_events_created_at on public.integration_events(created_at desc);
create index if not exists idx_api_connections_company_id on public.api_connections(company_id);

alter table public.integration_providers enable row level security;
alter table public.company_integrations enable row level security;
alter table public.integration_sync_logs enable row level security;
alter table public.integration_events enable row level security;
alter table public.api_connections enable row level security;

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
        and lower(coalesce(cu.role, '')) in ('owner', 'company_owner', 'admin', 'company_admin', 'dispatcher', 'accounting')
    );
$$;

drop policy if exists integration_providers_read on public.integration_providers;
create policy integration_providers_read
on public.integration_providers
for select
to authenticated
using (true);

drop policy if exists company_integrations_read on public.company_integrations;
drop policy if exists company_integrations_insert on public.company_integrations;
drop policy if exists company_integrations_update on public.company_integrations;
drop policy if exists company_integrations_delete on public.company_integrations;

create policy company_integrations_read on public.company_integrations
for select to authenticated
using (public.user_is_platform_admin() or public.user_has_company_access(company_id));

create policy company_integrations_insert on public.company_integrations
for insert to authenticated
with check (company_id is not null and public.user_can_manage_company_integrations(company_id));

create policy company_integrations_update on public.company_integrations
for update to authenticated
using (public.user_can_manage_company_integrations(company_id))
with check (public.user_can_manage_company_integrations(company_id));

create policy company_integrations_delete on public.company_integrations
for delete to authenticated
using (public.user_is_platform_admin() or public.user_is_company_admin(company_id));

drop policy if exists integration_events_read on public.integration_events;
drop policy if exists integration_events_insert on public.integration_events;
drop policy if exists integration_events_update on public.integration_events;
drop policy if exists integration_events_delete on public.integration_events;

create policy integration_events_read on public.integration_events
for select to authenticated
using (public.user_is_platform_admin() or public.user_has_company_access(company_id));

create policy integration_events_insert on public.integration_events
for insert to authenticated
with check (company_id is not null and public.user_can_manage_company_integrations(company_id));

create policy integration_events_update on public.integration_events
for update to authenticated
using (public.user_can_manage_company_integrations(company_id))
with check (public.user_can_manage_company_integrations(company_id));

create policy integration_events_delete on public.integration_events
for delete to authenticated
using (public.user_is_platform_admin() or public.user_is_company_admin(company_id));

-- Shared company-isolation policies for integration data tables.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'api_connections',
    'integration_sync_logs',
    'routes',
    'route_segments',
    'route_restrictions',
    'toll_costs',
    'fuel_discounts',
    'vehicle_locations',
    'driver_status',
    'engine_faults',
    'vehicle_health',
    'load_rates',
    'weather_alerts',
    'risk_scores',
    'maintenance_alerts',
    'fault_codes',
    'repair_recommendations',
    'carrier_scores',
    'driver_violations',
    'hos_logs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete', table_name);

    execute format('create policy %I on public.%I for select to authenticated using (public.user_is_platform_admin() or public.user_has_company_access(company_id))', table_name || '_read', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (company_id is not null and (public.user_is_platform_admin() or public.user_has_company_access(company_id)))', table_name || '_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (public.user_is_platform_admin() or public.user_has_company_access(company_id)) with check (public.user_is_platform_admin() or public.user_has_company_access(company_id))', table_name || '_update', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (public.user_is_platform_admin() or public.user_is_company_admin(company_id))', table_name || '_delete', table_name);
  end loop;
end $$;

-- Fuel stations and brokers may support public/global records with null company_id.
alter table public.fuel_stations enable row level security;
drop policy if exists fuel_stations_read on public.fuel_stations;
drop policy if exists fuel_stations_insert on public.fuel_stations;
drop policy if exists fuel_stations_update on public.fuel_stations;
drop policy if exists fuel_stations_delete on public.fuel_stations;
create policy fuel_stations_read on public.fuel_stations
for select to authenticated
using (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id));
create policy fuel_stations_insert on public.fuel_stations
for insert to authenticated
with check (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id));
create policy fuel_stations_update on public.fuel_stations
for update to authenticated
using (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id))
with check (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id));
create policy fuel_stations_delete on public.fuel_stations
for delete to authenticated
using (public.user_is_platform_admin() or (company_id is not null and public.user_is_company_admin(company_id)));

alter table public.fuel_prices enable row level security;
drop policy if exists fuel_prices_read on public.fuel_prices;
drop policy if exists fuel_prices_insert on public.fuel_prices;
drop policy if exists fuel_prices_update on public.fuel_prices;
drop policy if exists fuel_prices_delete on public.fuel_prices;
create policy fuel_prices_read on public.fuel_prices
for select to authenticated
using (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id));
create policy fuel_prices_insert on public.fuel_prices
for insert to authenticated
with check (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id));
create policy fuel_prices_update on public.fuel_prices
for update to authenticated
using (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id))
with check (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id));
create policy fuel_prices_delete on public.fuel_prices
for delete to authenticated
using (public.user_is_platform_admin() or (company_id is not null and public.user_is_company_admin(company_id)));

alter table public.brokers enable row level security;
drop policy if exists brokers_read on public.brokers;
drop policy if exists brokers_insert on public.brokers;
drop policy if exists brokers_update on public.brokers;
drop policy if exists brokers_delete on public.brokers;
create policy brokers_read on public.brokers
for select to authenticated
using (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id));
create policy brokers_insert on public.brokers
for insert to authenticated
with check (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id));
create policy brokers_update on public.brokers
for update to authenticated
using (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id))
with check (company_id is null or public.user_is_platform_admin() or public.user_has_company_access(company_id));
create policy brokers_delete on public.brokers
for delete to authenticated
using (public.user_is_platform_admin() or (company_id is not null and public.user_is_company_admin(company_id)));

select
  'integration hub ready' as status,
  count(*) filter (where table_name = 'integration_providers') as provider_table,
  count(*) filter (where table_name = 'company_integrations') as company_integrations_table,
  count(*) filter (where table_name = 'routes') as routes_table,
  count(*) filter (where table_name = 'vehicle_locations') as telematics_table,
  count(*) filter (where table_name = 'carrier_scores') as compliance_table
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'integration_providers',
    'company_integrations',
    'routes',
    'vehicle_locations',
    'carrier_scores'
  );
