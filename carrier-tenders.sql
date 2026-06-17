create table if not exists public.load_tenders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  load_id bigint not null references public.loads(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  tender_number text,
  status text not null default 'draft',
  carrier_rate numeric not null default 0,
  contact_name text,
  contact_email text,
  contact_phone text,
  expires_at timestamp with time zone,
  sent_at timestamp with time zone,
  responded_at timestamp with time zone,
  terms text,
  notes text,
  constraint load_tenders_status_check check (status in ('draft', 'sent', 'accepted', 'rejected', 'cancelled'))
);

alter table public.load_tenders
add column if not exists updated_at timestamp with time zone not null default now(),
add column if not exists tender_number text,
add column if not exists contact_name text,
add column if not exists contact_email text,
add column if not exists contact_phone text,
add column if not exists expires_at timestamp with time zone,
add column if not exists sent_at timestamp with time zone,
add column if not exists responded_at timestamp with time zone,
add column if not exists terms text,
add column if not exists notes text;

alter table public.load_tenders
drop constraint if exists load_tenders_status_check;

alter table public.load_tenders
add constraint load_tenders_status_check
check (status in ('draft', 'sent', 'accepted', 'rejected', 'cancelled'));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_load_tenders_updated_at on public.load_tenders;
create trigger set_load_tenders_updated_at
before update on public.load_tenders
for each row
execute function public.set_updated_at();

create unique index if not exists load_tenders_one_accepted_idx
on public.load_tenders(load_id)
where status = 'accepted';

create index if not exists load_tenders_company_id_idx on public.load_tenders(company_id);
create index if not exists load_tenders_load_id_idx on public.load_tenders(load_id);
create index if not exists load_tenders_carrier_id_idx on public.load_tenders(carrier_id);
create index if not exists load_tenders_status_idx on public.load_tenders(status);

alter table public.load_tenders enable row level security;

drop policy if exists "load_tenders_read" on public.load_tenders;
create policy "load_tenders_read"
on public.load_tenders
for select
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "load_tenders_insert" on public.load_tenders;
create policy "load_tenders_insert"
on public.load_tenders
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "load_tenders_update" on public.load_tenders;
create policy "load_tenders_update"
on public.load_tenders
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

drop policy if exists "load_tenders_delete" on public.load_tenders;
create policy "load_tenders_delete"
on public.load_tenders
for delete
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_admin(company_id)
);

grant select, insert, update, delete on public.load_tenders to authenticated;
