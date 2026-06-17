with required_tables(area, table_name, requires_company_id) as (
  values
    ('Core SaaS', 'companies', false),
    ('Core SaaS', 'company_users', true),
    ('Core SaaS', 'user_invites', true),
    ('Billing', 'company_subscriptions', true),
    ('Operations', 'drivers', true),
    ('Operations', 'trucks', true),
    ('Operations', 'loads', true),
    ('Operations', 'assignments', true),
    ('Operations', 'customers', true),
    ('3PL', 'carriers', true),
    ('3PL', 'load_tenders', true),
    ('Operations', 'load_communications', true),
    ('Operations', 'load_issues', true),
    ('Operations', 'quotes', true),
    ('Billing', 'invoices', true),
    ('Billing', 'settlements', true),
    ('Documents', 'documents', true),
    ('Maintenance', 'maintenance_logs', true),
    ('Maintenance', 'maintenance_schedules', true),
    ('Tracking', 'load_events', true),
    ('Audit', 'activity_logs', true),
    ('Support', 'support_tickets', true),
    ('Support', 'support_ticket_messages', true),
    ('Support', 'notifications', true),
    ('Fleet', 'alerts', true)
),
table_checks as (
  select
    rt.area,
    rt.table_name,
    rt.requires_company_id,
    c.oid as table_oid,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced
  from required_tables rt
  left join pg_class c
    on c.relname = rt.table_name
  left join pg_namespace n
    on n.oid = c.relnamespace
   and n.nspname = 'public'
),
column_checks as (
  select
    table_name,
    count(*) filter (where column_name = 'company_id') > 0 as has_company_id
  from information_schema.columns
  where table_schema = 'public'
  group by table_name
),
policy_checks as (
  select
    tablename as table_name,
    count(*) as policy_count,
    bool_or(
      coalesce(qual, '') ilike '%company_id%' or
      coalesce(with_check, '') ilike '%company_id%' or
      coalesce(qual, '') ilike '%user_is_company%' or
      coalesce(with_check, '') ilike '%user_is_company%' or
      coalesce(qual, '') ilike '%platform_admin%' or
      coalesce(with_check, '') ilike '%platform_admin%'
    ) as has_company_policy_logic
  from pg_policies
  where schemaname = 'public'
  group by tablename
),
row_checks as (
  select 'company_users' as table_name, count(*) filter (where company_id is null) as missing_company_id from public.company_users
  union all select 'user_invites', count(*) filter (where company_id is null) from public.user_invites
  union all select 'company_subscriptions', count(*) filter (where company_id is null) from public.company_subscriptions
  union all select 'drivers', count(*) filter (where company_id is null) from public.drivers
  union all select 'trucks', count(*) filter (where company_id is null) from public.trucks
  union all select 'loads', count(*) filter (where company_id is null) from public.loads
  union all select 'assignments', count(*) filter (where company_id is null) from public.assignments
  union all select 'customers', count(*) filter (where company_id is null) from public.customers
  union all select 'carriers', count(*) filter (where company_id is null) from public.carriers
  union all select 'load_tenders', count(*) filter (where company_id is null) from public.load_tenders
  union all select 'load_communications', count(*) filter (where company_id is null) from public.load_communications
  union all select 'load_issues', count(*) filter (where company_id is null) from public.load_issues
  union all select 'quotes', count(*) filter (where company_id is null) from public.quotes
  union all select 'invoices', count(*) filter (where company_id is null) from public.invoices
  union all select 'settlements', count(*) filter (where company_id is null) from public.settlements
  union all select 'documents', count(*) filter (where company_id is null) from public.documents
  union all select 'maintenance_logs', count(*) filter (where company_id is null) from public.maintenance_logs
  union all select 'maintenance_schedules', count(*) filter (where company_id is null) from public.maintenance_schedules
  union all select 'load_events', count(*) filter (where company_id is null) from public.load_events
  union all select 'activity_logs', count(*) filter (where company_id is null) from public.activity_logs
  union all select 'support_tickets', count(*) filter (where company_id is null) from public.support_tickets
  union all select 'support_ticket_messages', count(*) filter (where company_id is null) from public.support_ticket_messages
  union all select 'notifications', count(*) filter (where company_id is null) from public.notifications
  union all select 'alerts', count(*) filter (where company_id is null) from public.alerts
)
select
  tc.area,
  tc.table_name,
  case
    when tc.table_oid is null then 'BLOCKER'
    when tc.requires_company_id and not coalesce(cc.has_company_id, false) then 'BLOCKER'
    when tc.requires_company_id and coalesce(rc.missing_company_id, 0) > 0 then 'BLOCKER'
    when not tc.rls_enabled then 'BLOCKER'
    when coalesce(pc.policy_count, 0) = 0 then 'BLOCKER'
    when tc.requires_company_id and not coalesce(pc.has_company_policy_logic, false) then 'WARNING'
    else 'PASS'
  end as security_status,
  tc.requires_company_id,
  coalesce(cc.has_company_id, false) as has_company_id,
  coalesce(rc.missing_company_id, 0) as rows_missing_company_id,
  coalesce(tc.rls_enabled, false) as rls_enabled,
  coalesce(tc.rls_forced, false) as rls_forced,
  coalesce(pc.policy_count, 0) as policy_count,
  coalesce(pc.has_company_policy_logic, false) as has_company_policy_logic,
  case
    when tc.table_oid is null then 'Table is missing.'
    when tc.requires_company_id and not coalesce(cc.has_company_id, false) then 'Table needs company_id before multi-company selling.'
    when tc.requires_company_id and coalesce(rc.missing_company_id, 0) > 0 then 'Rows exist without company_id. Fix before selling.'
    when not tc.rls_enabled then 'RLS is not enabled.'
    when coalesce(pc.policy_count, 0) = 0 then 'No RLS policies found.'
    when tc.requires_company_id and not coalesce(pc.has_company_policy_logic, false) then 'Policies exist, but audit did not detect company/platform logic. Review manually.'
    else 'Looks ready.'
  end as recommendation
from table_checks tc
left join column_checks cc
  on cc.table_name = tc.table_name
left join policy_checks pc
  on pc.table_name = tc.table_name
left join row_checks rc
  on rc.table_name = tc.table_name
order by
  case
    when tc.table_oid is null then 1
    when tc.requires_company_id and not coalesce(cc.has_company_id, false) then 2
    when tc.requires_company_id and coalesce(rc.missing_company_id, 0) > 0 then 3
    when not tc.rls_enabled then 4
    when coalesce(pc.policy_count, 0) = 0 then 5
    when tc.requires_company_id and not coalesce(pc.has_company_policy_logic, false) then 6
    else 7
  end,
  tc.area,
  tc.table_name;
