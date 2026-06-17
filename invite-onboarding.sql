-- HyperRoute Intelligence
-- Automatic invitation onboarding.
-- Safe to run more than once in Supabase SQL Editor.

create or replace function public.accept_pending_company_invite()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_record public.user_invites%rowtype;
  current_email text;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in to accept an invite.';
  end if;

  current_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if current_email = '' then
    return null;
  end if;

  select *
  into invite_record
  from public.user_invites
  where lower(email) = current_email
    and status in ('pending', 'sent')
  order by created_at asc
  limit 1;

  if invite_record.id is null then
    return null;
  end if;

  insert into public.company_users (
    company_id,
    user_id,
    role,
    status
  )
  values (
    invite_record.company_id,
    auth.uid(),
    invite_record.role,
    'active'
  )
  on conflict (company_id, user_id)
  do update set
    role = excluded.role,
    status = 'active';

  update public.user_invites
  set
    status = 'accepted',
    updated_at = now()
  where id = invite_record.id;

  return invite_record.company_id;
end;
$$;

grant execute on function public.accept_pending_company_invite()
to authenticated;
