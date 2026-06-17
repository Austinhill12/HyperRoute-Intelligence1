create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  created_by uuid references auth.users(id),
  assigned_to uuid references auth.users(id),
  subject text not null,
  description text not null,
  category text not null default 'general',
  priority text not null default 'normal',
  status text not null default 'open',
  resolution_notes text,
  resolved_at timestamp with time zone,
  closed_at timestamp with time zone,
  constraint support_tickets_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint support_tickets_status_check check (status in ('open', 'in_progress', 'resolved', 'closed')),
  constraint support_tickets_category_check check (category in ('general', 'bug', 'billing', 'training', 'feature_request', 'data_issue'))
);

create index if not exists support_tickets_company_id_idx on public.support_tickets(company_id);
create index if not exists support_tickets_status_idx on public.support_tickets(status);
create index if not exists support_tickets_priority_idx on public.support_tickets(priority);
create index if not exists support_tickets_created_at_idx on public.support_tickets(created_at desc);

create or replace function public.set_support_ticket_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();

  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at = now();
  end if;

  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at
before update on public.support_tickets
for each row execute function public.set_support_ticket_updated_at();

alter table public.support_tickets enable row level security;

drop policy if exists "support_tickets_company_read" on public.support_tickets;
create policy "support_tickets_company_read"
on public.support_tickets
for select
to authenticated
using (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "support_tickets_company_insert" on public.support_tickets;
create policy "support_tickets_company_insert"
on public.support_tickets
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or public.user_is_company_member(company_id)
);

drop policy if exists "support_tickets_company_update" on public.support_tickets;
create policy "support_tickets_company_update"
on public.support_tickets
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

drop policy if exists "support_tickets_company_delete" on public.support_tickets;
create policy "support_tickets_company_delete"
on public.support_tickets
for delete
to authenticated
using (
  public.user_is_platform_admin()
);

grant select, insert, update, delete on public.support_tickets to authenticated;

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  created_by uuid references auth.users(id),
  author_role text,
  message text not null,
  internal_note boolean not null default false
);

create index if not exists support_ticket_messages_ticket_id_idx
on public.support_ticket_messages(ticket_id, created_at asc);

create index if not exists support_ticket_messages_company_id_idx
on public.support_ticket_messages(company_id);

alter table public.support_ticket_messages enable row level security;

drop policy if exists "support_ticket_messages_read" on public.support_ticket_messages;
create policy "support_ticket_messages_read"
on public.support_ticket_messages
for select
to authenticated
using (
  public.user_is_platform_admin()
  or (
    internal_note = false
    and public.user_is_company_member(company_id)
  )
);

drop policy if exists "support_ticket_messages_insert" on public.support_ticket_messages;
create policy "support_ticket_messages_insert"
on public.support_ticket_messages
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or (
    internal_note = false
    and public.user_is_company_member(company_id)
  )
);

drop policy if exists "support_ticket_messages_update" on public.support_ticket_messages;
create policy "support_ticket_messages_update"
on public.support_ticket_messages
for update
to authenticated
using (
  public.user_is_platform_admin()
)
with check (
  public.user_is_platform_admin()
);

drop policy if exists "support_ticket_messages_delete" on public.support_ticket_messages;
create policy "support_ticket_messages_delete"
on public.support_ticket_messages
for delete
to authenticated
using (
  public.user_is_platform_admin()
);

grant select, insert, update, delete on public.support_ticket_messages to authenticated;
