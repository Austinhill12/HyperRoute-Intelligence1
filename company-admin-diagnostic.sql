select
  count(*) as total_companies
from public.companies;

select
  id,
  company_name,
  legal_name,
  status,
  created_at,
  updated_at
from public.companies
order by created_at desc;
