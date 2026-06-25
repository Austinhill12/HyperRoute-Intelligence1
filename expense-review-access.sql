-- HyperRoute Expense Review role access
-- Run this if accounting/dispatcher users need to approve or reject driver expenses.

create or replace function public.user_can_manage_company_expenses(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_is_platform_admin()
    or public.user_is_company_admin(target_company_id)
    or exists (
      select 1
      from public.company_users cu
      where cu.company_id = target_company_id
        and cu.user_id = auth.uid()
        and lower(coalesce(cu.status, '')) = 'active'
        and lower(coalesce(cu.role, '')) in (
          'owner',
          'company_owner',
          'admin',
          'company_admin',
          'accounting',
          'dispatcher'
        )
    );
$$;

drop policy if exists load_expenses_company_update on public.load_expenses;

create policy load_expenses_company_update
on public.load_expenses
for update
to authenticated
using (
  public.user_can_manage_company_expenses(company_id)
)
with check (
  public.user_can_manage_company_expenses(company_id)
);
