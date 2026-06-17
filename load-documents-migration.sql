-- HyperRoute Intelligence
-- Optional: copy existing load_documents records into the central documents table.
-- Run only after documents-storage.sql has succeeded.

do $$
begin
  if to_regclass('public.load_documents') is null then
    return;
  end if;

  insert into public.documents (
    created_at,
    company_id,
    entity_type,
    entity_id,
    document_type,
    file_name,
    file_path,
    notes
  )
  select
    coalesce(ld.created_at, now()),
    ld.company_id,
    'load',
    ld.load_id::text,
    coalesce(ld.document_type, 'other'),
    coalesce(split_part(ld.document_url, '/', array_length(string_to_array(ld.document_url, '/'), 1)), 'Load Document'),
    ld.document_url,
    ld.notes
  from public.load_documents ld
  where ld.company_id is not null
    and ld.document_url is not null
    and not exists (
      select 1
      from public.documents d
      where d.company_id = ld.company_id
        and d.entity_type = 'load'
        and d.entity_id = ld.load_id::text
        and d.file_path = ld.document_url
    );
end $$;
