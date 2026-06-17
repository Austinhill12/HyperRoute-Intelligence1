-- HyperRoute Intelligence
-- Make a11hill@bop.gov platform admin and company owner for all companies.

create or replace function public.user_is_platform_admin()
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
      and pa.status = 'active'
  );
$$;

insert into public.platform_admins (user_id, role, status)
select
  u.id,
  'platform_admin',
  'active'
from auth.users u
where lower(u.email) = lower('a11hill@bop.gov')
on conflict (user_id)
do update set
  role = 'platform_admin',
  status = 'active';

insert into public.company_users (company_id, user_id, role, status)
select
  c.id,
  u.id,
  'company_owner',
  'active'
from public.companies c
cross join auth.users u
where lower(u.email) = lower('a11hill@bop.gov')
on conflict (company_id, user_id)
do update set
  role = 'company_owner',
  status = 'active';

select
  u.id as auth_user_id,
  u.email,
  pa.role as platform_role,
  pa.status as platform_status
from auth.users u
left join public.platform_admins pa on pa.user_id = u.id
where lower(u.email) = lower('a11hill@bop.gov');

select
  c.company_name,
  cu.role,
  cu.status
from public.company_users cu
join public.companies c on c.id = cu.company_id
join auth.users u on u.id = cu.user_id
where lower(u.email) = lower('a11hill@bop.gov')
order by c.company_name;
