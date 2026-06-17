create table if not exists public.load_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id bigint not null references public.loads(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  issue_type text not null default 'other',
  severity text not null default 'medium',
  status text not null default 'open',
  responsible_party text not null default 'unknown',
  title text not null,
  description text,
  claim_amount numeric,
  due_at timestamp with time zone,
  resolved_at timestamp with time zone,
  resolution text,
  created_by uuid,
  constraint load_issues_type_check check (issue_type in ('late_pickup', 'late_delivery', 'damaged_freight', 'missing_pod', 'billing_dispute', 'carrier_no_show', 'customer_complaint', 'accessorial_dispute', 'other')),
  constraint load_issues_severity_check check (severity in ('low', 'medium', 'high', 'critical')),
  constraint load_issues_status_check check (status in ('open', 'in_progress', 'resolved', 'closed')),
  constraint load_issues_responsible_party_check check (responsible_party in ('customer', 'carrier', 'driver', 'company', 'shipper', 'consignee', 'unknown'))
);

alter table public.load_issues
add column if not exists updated_at timestamp with time zone not null default now(),
add column if not exists issue_type text not null default 'other',
add column if not exists severity text not null default 'medium',
add column if not exists status text not null default 'open',
add column if not exists responsible_party text not null default 'unknown',
add column if not exists title text,
add column if not exists description text,
add column if not exists claim_amount numeric,
add column if not exists due_at timestamp with time zone,
add column if not exists resolved_at timestamp with time zone,
add column if not exists resolution text,
add column if not exists created_by uuid;

alter table public.load_issues
drop constraint if exists load_issues_type_check,
drop constraint if exists load_issues_severity_check,
drop constraint if exists load_issues_status_check,
drop constraint if exists load_issues_responsible_party_check;

alter table public.load_issues
add constraint load_issues_type_check check (issue_type in ('late_pickup', 'late_delivery', 'damaged_freight', 'missing_pod', 'billing_dispute', 'carrier_no_show', 'customer_complaint', 'accessorial_dispute', 'other')),
add constraint load_issues_severity_check check (severity in ('low', 'medium', 'high', 'critical')),
add constraint load_issues_status_check check (status in ('open', 'in_progress', 'resolved', 'closed')),
add constraint load_issues_responsible_party_check check (responsible_party in ('customer', 'carrier', 'driver', 'company', 'shipper', 'consignee', 'unknown'));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_load_issues_updated_at on public.load_issues;
create trigger set_load_issues_updated_at
before update on public.load_issues
for each row
execute function public.set_updated_at();

create index if not exists load_issues_company_id_idx on public.load_issues(company_id);
create index if not exists load_issues_load_id_idx on public.load_issues(load_id);
create index if not exists load_issues_status_idx on public.load_issues(status);
create index if not exists load_issues_severity_idx on public.load_issues(severity);
create index if not exists load_issues_due_at_idx on public.load_issues(due_at);

alter table public.load_issues enable row level security;

drop policy if exists "load_issues_read" on public.load_issues;
create policy "load_issues_read"
on public.load_issues
for select
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "load_issues_insert" on public.load_issues;
create policy "load_issues_insert"
on public.load_issues
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "load_issues_update" on public.load_issues;
create policy "load_issues_update"
on public.load_issues
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

drop policy if exists "load_issues_delete" on public.load_issues;
create policy "load_issues_delete"
on public.load_issues
for delete
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);

grant select, insert, update, delete on public.load_issues to authenticated;
