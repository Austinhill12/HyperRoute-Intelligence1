create table if not exists public.load_communications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id bigint not null references public.loads(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  contact_type text not null default 'customer',
  channel text not null default 'phone',
  direction text not null default 'outbound',
  contact_name text,
  contact_detail text,
  subject text,
  summary text not null,
  next_follow_up_at timestamp with time zone,
  status text not null default 'open',
  created_by uuid,
  constraint load_communications_contact_type_check check (contact_type in ('customer', 'carrier', 'driver', 'internal', 'other')),
  constraint load_communications_channel_check check (channel in ('phone', 'email', 'sms', 'portal', 'in_person', 'other')),
  constraint load_communications_direction_check check (direction in ('inbound', 'outbound', 'internal')),
  constraint load_communications_status_check check (status in ('open', 'completed', 'no_follow_up_needed'))
);

alter table public.load_communications
add column if not exists updated_at timestamp with time zone not null default now(),
add column if not exists contact_type text not null default 'customer',
add column if not exists channel text not null default 'phone',
add column if not exists direction text not null default 'outbound',
add column if not exists contact_name text,
add column if not exists contact_detail text,
add column if not exists subject text,
add column if not exists summary text,
add column if not exists next_follow_up_at timestamp with time zone,
add column if not exists status text not null default 'open',
add column if not exists created_by uuid;

alter table public.load_communications
drop constraint if exists load_communications_contact_type_check,
drop constraint if exists load_communications_channel_check,
drop constraint if exists load_communications_direction_check,
drop constraint if exists load_communications_status_check;

alter table public.load_communications
add constraint load_communications_contact_type_check check (contact_type in ('customer', 'carrier', 'driver', 'internal', 'other')),
add constraint load_communications_channel_check check (channel in ('phone', 'email', 'sms', 'portal', 'in_person', 'other')),
add constraint load_communications_direction_check check (direction in ('inbound', 'outbound', 'internal')),
add constraint load_communications_status_check check (status in ('open', 'completed', 'no_follow_up_needed'));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_load_communications_updated_at on public.load_communications;
create trigger set_load_communications_updated_at
before update on public.load_communications
for each row
execute function public.set_updated_at();

create index if not exists load_communications_company_id_idx on public.load_communications(company_id);
create index if not exists load_communications_load_id_idx on public.load_communications(load_id);
create index if not exists load_communications_status_idx on public.load_communications(status);
create index if not exists load_communications_next_follow_up_at_idx on public.load_communications(next_follow_up_at);

alter table public.load_communications enable row level security;

drop policy if exists "load_communications_read" on public.load_communications;
create policy "load_communications_read"
on public.load_communications
for select
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "load_communications_insert" on public.load_communications;
create policy "load_communications_insert"
on public.load_communications
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "load_communications_update" on public.load_communications;
create policy "load_communications_update"
on public.load_communications
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

drop policy if exists "load_communications_delete" on public.load_communications;
create policy "load_communications_delete"
on public.load_communications
for delete
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);

grant select, insert, update, delete on public.load_communications to authenticated;
