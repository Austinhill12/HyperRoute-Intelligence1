create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamp with time zone not null default now(),
  read_at timestamp with time zone,
  audience text not null default 'company',
  notification_type text not null default 'general',
  priority text not null default 'normal',
  title text not null,
  message text not null,
  target_url text,
  notification_key text,
  metadata jsonb not null default '{}'::jsonb,
  constraint notifications_audience_check check (audience in ('company', 'platform')),
  constraint notifications_priority_check check (priority in ('low', 'normal', 'high', 'urgent'))
);

alter table public.notifications
add column if not exists notification_key text;

create index if not exists notifications_company_id_idx
on public.notifications(company_id);

create index if not exists notifications_user_id_idx
on public.notifications(user_id);

create index if not exists notifications_read_at_idx
on public.notifications(read_at);

create index if not exists notifications_created_at_idx
on public.notifications(created_at desc);

create unique index if not exists notifications_notification_key_idx
on public.notifications(notification_key)
where notification_key is not null;

alter table public.notifications enable row level security;

drop policy if exists "notifications_read" on public.notifications;
create policy "notifications_read"
on public.notifications
for select
to authenticated
using (
  public.user_is_platform_admin()
  or (
    audience = 'company'
    and company_id is not null
    and public.user_is_company_member(company_id)
    and (user_id is null or user_id = auth.uid())
  )
);

drop policy if exists "notifications_insert" on public.notifications;
create policy "notifications_insert"
on public.notifications
for insert
to authenticated
with check (
  public.user_is_platform_admin()
  or (
    company_id is not null
    and public.user_is_company_member(company_id)
  )
);

drop policy if exists "notifications_update" on public.notifications;
create policy "notifications_update"
on public.notifications
for update
to authenticated
using (
  public.user_is_platform_admin()
  or (
    audience = 'company'
    and company_id is not null
    and public.user_is_company_member(company_id)
    and (user_id is null or user_id = auth.uid())
  )
)
with check (
  public.user_is_platform_admin()
  or (
    audience = 'company'
    and company_id is not null
    and public.user_is_company_member(company_id)
    and (user_id is null or user_id = auth.uid())
  )
);

drop policy if exists "notifications_delete" on public.notifications;
create policy "notifications_delete"
on public.notifications
for delete
to authenticated
using (
  public.user_is_platform_admin()
);

grant select, insert, update, delete on public.notifications to authenticated;
