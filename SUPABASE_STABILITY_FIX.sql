begin;

create or replace function public.hri_user_is_platform_admin_v2()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
      and lower(coalesce(pa.status, '')) = 'active'
  );
$$;

create or replace function public.hri_user_has_company_access_v2(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.hri_user_is_platform_admin_v2()
    or exists (
      select 1
      from public.company_users cu
      where cu.company_id = target_company_id
        and cu.user_id = auth.uid()
        and lower(coalesce(cu.status, '')) = 'active'
    );
$$;

create or replace function public.hri_user_is_company_admin_v2(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.hri_user_is_platform_admin_v2()
    or exists (
      select 1
      from public.company_users cu
      where cu.company_id = target_company_id
        and cu.user_id = auth.uid()
        and lower(coalesce(cu.status, '')) = 'active'
        and lower(coalesce(cu.role, '')) in (
          'owner',
          'admin',
          'company_owner',
          'company owner',
          'company_admin',
          'company admin'
        )
    );
$$;

grant execute on function public.hri_user_is_platform_admin_v2() to authenticated;
grant execute on function public.hri_user_has_company_access_v2(uuid) to authenticated;
grant execute on function public.hri_user_is_company_admin_v2(uuid) to authenticated;

alter table public.companies enable row level security;
alter table public.company_users enable row level security;
alter table public.drivers enable row level security;

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('companies', 'drivers')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      p.policyname,
      p.schemaname,
      p.tablename
    );
  end loop;
end $$;

create policy companies_member_read
on public.companies
for select
to authenticated
using (
  public.hri_user_is_platform_admin_v2()
  or public.hri_user_has_company_access_v2(id)
);

create policy companies_authenticated_insert
on public.companies
for insert
to authenticated
with check (true);

create policy companies_admin_update
on public.companies
for update
to authenticated
using (public.hri_user_is_company_admin_v2(id))
with check (public.hri_user_is_company_admin_v2(id));

create policy companies_platform_delete
on public.companies
for delete
to authenticated
using (public.hri_user_is_platform_admin_v2());

create policy drivers_company_read
on public.drivers
for select
to authenticated
using (
  company_id is not null
  and public.hri_user_has_company_access_v2(company_id)
);

create policy drivers_company_insert
on public.drivers
for insert
to authenticated
with check (
  company_id is not null
  and public.hri_user_has_company_access_v2(company_id)
);

create policy drivers_company_update
on public.drivers
for update
to authenticated
using (
  company_id is not null
  and public.hri_user_is_company_admin_v2(company_id)
)
with check (
  company_id is not null
  and public.hri_user_is_company_admin_v2(company_id)
);

create policy drivers_company_delete
on public.drivers
for delete
to authenticated
using (
  company_id is not null
  and public.hri_user_is_company_admin_v2(company_id)
);

commit;
