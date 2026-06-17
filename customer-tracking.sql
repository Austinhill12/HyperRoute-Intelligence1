-- HyperRoute Intelligence
-- Customer-facing load tracking.
-- Safe to run more than once.

alter table public.loads
add column if not exists tracking_code text;

update public.loads
set tracking_code = upper(substr(md5(id::text || '-' || coalesce(load_number, '') || '-' || created_at::text), 1, 10))
where tracking_code is null;

create unique index if not exists idx_loads_tracking_code_unique
on public.loads(tracking_code)
where tracking_code is not null;

create or replace function public.get_public_load_tracking(search_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_input text;
  load_record public.loads%rowtype;
  company_name_value text;
  company_phone_value text;
  company_email_value text;
  timeline_value jsonb;
  pod_available_value boolean;
  invoice_status_value text;
begin
  normalized_input := trim(coalesce(search_input, ''));

  if normalized_input = '' then
    return jsonb_build_object('found', false);
  end if;

  select *
  into load_record
  from public.loads
  where lower(coalesce(tracking_code, '')) = lower(normalized_input)
     or lower(coalesce(load_number, '')) = lower(normalized_input)
     or id::text = normalized_input
  order by
    case
      when lower(coalesce(tracking_code, '')) = lower(normalized_input) then 0
      when lower(coalesce(load_number, '')) = lower(normalized_input) then 1
      else 2
    end,
    created_at desc
  limit 1;

  if load_record.id is null then
    return jsonb_build_object('found', false);
  end if;

  select c.company_name, c.phone, c.email
  into company_name_value, company_phone_value, company_email_value
  from public.companies c
  where c.id = load_record.company_id
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_type', event_type,
        'event_time', event_time,
        'location', location,
        'notes', notes
      )
      order by event_time asc
    ),
    '[]'::jsonb
  )
  into timeline_value
  from public.load_events
  where load_id = load_record.id
    and (
      company_id = load_record.company_id
      or company_id is null
    );

  select exists (
    select 1
    from public.documents d
    where d.company_id = load_record.company_id
      and d.entity_type = 'load'
      and d.entity_id = load_record.id::text
      and lower(d.document_type) in ('pod', 'proof_of_delivery')
  )
  into pod_available_value;

  select i.status
  into invoice_status_value
  from public.invoices i
  where i.company_id = load_record.company_id
    and i.load_id = load_record.id
    and coalesce(i.status, '') <> 'void'
  order by i.created_at desc
  limit 1;

  return jsonb_build_object(
    'found', true,
    'company_name', coalesce(company_name_value, 'HyperRoute Intelligence'),
    'company_phone', company_phone_value,
    'company_email', company_email_value,
    'load_id', load_record.id,
    'load_number', load_record.load_number,
    'tracking_code', load_record.tracking_code,
    'customer_name', coalesce(load_record.customer_name, load_record.customer),
    'status', load_record.status,
    'pickup_location', load_record.pickup_location,
    'pickup_date', load_record.pickup_date,
    'pickup_time', load_record.pickup_time,
    'delivery_location', coalesce(load_record.delivery_location, load_record.dropoff_location),
    'delivery_date', coalesce(load_record.delivery_date, load_record.dropoff_date),
    'delivery_time', load_record.delivery_time,
    'shipper_name', load_record.shipper_name,
    'shipper_contact', load_record.shipper_contact,
    'consignee_name', load_record.consignee_name,
    'consignee_contact', load_record.consignee_contact,
    'created_at', load_record.created_at,
    'last_updated', coalesce((select max((event->>'event_time')::timestamptz) from jsonb_array_elements(timeline_value) event), load_record.created_at),
    'pod_available', coalesce(pod_available_value, false),
    'invoice_status', invoice_status_value,
    'timeline', timeline_value
  );
end;
$$;

grant execute on function public.get_public_load_tracking(text) to anon;
grant execute on function public.get_public_load_tracking(text) to authenticated;
