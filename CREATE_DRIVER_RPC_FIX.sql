begin;

create or replace function public.create_driver_for_current_company_v2(
  p_company_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text default null,
  p_email text default null,
  p_license_number text default null,
  p_license_expiration text default null,
  p_photo_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  target_company_id uuid;
  new_driver_id bigint;
  is_platform_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'Not logged in';
  end if;

  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
      and lower(coalesce(pa.status, '')) = 'active'
  )
  into is_platform_admin;

  if p_company_id is not null then
    target_company_id := p_company_id;
  else
    select cu.company_id
    into target_company_id
    from public.company_users cu
    join public.companies c on c.id = cu.company_id
    where cu.user_id = auth.uid()
      and lower(coalesce(cu.status, '')) = 'active'
      and lower(coalesce(c.status, '')) = 'active'
    order by cu.created_at desc
    limit 1;
  end if;

  if target_company_id is null then
    raise exception 'No active company found for this logged-in user.';
  end if;

  if not is_platform_admin and not exists (
    select 1
    from public.company_users cu
    where cu.company_id = target_company_id
      and cu.user_id = auth.uid()
      and lower(coalesce(cu.status, '')) = 'active'
  ) then
    raise exception 'You do not have access to this company.';
  end if;

  insert into public.drivers (
    company_id,
    first_name,
    last_name,
    phone,
    email,
    license_number,
    license_expiration,
    status,
    photo_url
  )
  values (
    target_company_id,
    nullif(trim(p_first_name), ''),
    nullif(trim(p_last_name), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_license_number, '')), ''),
    nullif(trim(coalesce(p_license_expiration, '')), ''),
    'active',
    nullif(trim(coalesce(p_photo_url, '')), '')
  )
  returning id into new_driver_id;

  return jsonb_build_object(
    'id', new_driver_id,
    'company_id', target_company_id,
    'message', 'Driver created successfully'
  );
end;
$$;

grant execute on function public.create_driver_for_current_company_v2(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

commit;
