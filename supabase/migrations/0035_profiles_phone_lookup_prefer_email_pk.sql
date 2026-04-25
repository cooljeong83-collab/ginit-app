-- Prefer email-based app_user_id when multiple profiles share same phone.
-- This avoids logging in as legacy phone-PK row when a canonical email-PK row exists.

create or replace function public.resolve_app_user_id_from_phone_e164(p_phone text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select trim(coalesce(p_phone, '')) as raw
  ),
  qd as (
    select raw, regexp_replace(raw, '[^0-9]', '', 'g') as digits
    from q
  ),
  matches as (
    select
      pr.app_user_id,
      -- Prefer canonical email PK
      case when pr.app_user_id like '%@%' then 1 else 0 end as is_email_pk,
      pr.updated_at
    from public.profiles pr, qd
    where coalesce(pr.is_withdrawn, false) = false
      and (
        pr.phone = qd.raw
        or regexp_replace(coalesce(pr.phone, ''), '[^0-9]', '', 'g') = qd.digits
      )
  )
  select m.app_user_id
  from matches m
  order by m.is_email_pk desc, m.updated_at desc nulls last
  limit 1;
$$;

revoke all on function public.resolve_app_user_id_from_phone_e164(text) from public;
grant execute on function public.resolve_app_user_id_from_phone_e164(text) to anon, authenticated;

-- keep has_profile_for_phone_e164 behavior but align matching criteria
create or replace function public.has_profile_for_phone_e164(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.resolve_app_user_id_from_phone_e164(p_phone) is not null
    and length(trim(public.resolve_app_user_id_from_phone_e164(p_phone))) > 0;
$$;

revoke all on function public.has_profile_for_phone_e164(text) from public;
grant execute on function public.has_profile_for_phone_e164(text) to anon, authenticated;

notify pgrst, 'reload schema';

