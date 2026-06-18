begin;

drop function if exists public.create_driver_secure_v8(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
);

create function public.create_driver_secure_v8(
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
  new_driver_id bigint;
  normalized_license_expiration date;
begin
  if auth.uid() is null then
    raise exception 'Not logged in. Please log out, log back in, and try again.';
  end if;

  if p_company_id is null then
    raise exception 'No active company selected for this user.';
  end if;

  if nullif(trim(coalesce(p_first_name, '')), '') is null then
    raise exception 'Driver first name is required.';
  end if;

  if nullif(trim(coalesce(p_last_name, '')), '') is null then
    raise exception 'Driver last name is required.';
  end if;

  if not exists (
    select 1
    from public.company_users cu
    join public.companies c on c.id = cu.company_id
    where cu.company_id = p_company_id
      and cu.user_id = auth.uid()
      and lower(coalesce(cu.status, '')) = 'active'
      and lower(coalesce(c.status, '')) = 'active'
  )
  and not exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
      and lower(coalesce(pa.status, '')) = 'active'
  ) then
    raise exception 'This logged-in user does not have access to the selected company.';
  end if;

  if nullif(trim(coalesce(p_license_expiration, '')), '') is not null then
    normalized_license_expiration := p_license_expiration::date;
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
    p_company_id,
    trim(p_first_name),
    trim(p_last_name),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_license_number, '')), ''),
    normalized_license_expiration,
    'active',
    nullif(trim(coalesce(p_photo_url, '')), '')
  )
  returning id into new_driver_id;

  return jsonb_build_object(
    'success', true,
    'id', new_driver_id,
    'company_id', p_company_id,
    'message', 'Driver created successfully'
  );
end;
$$;

grant execute on function public.create_driver_secure_v8(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

notify pgrst, 'reload schema';

commit;
