-- Relax phone lookup matching for legacy stored formats.
-- Some rows may have phone stored without '+' or with non-digit characters.

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
  )
  select pr.app_user_id
  from public.profiles pr, qd
  where coalesce(pr.is_withdrawn, false) = false
    and (
      pr.phone = qd.raw
      or regexp_replace(coalesce(pr.phone, ''), '[^0-9]', '', 'g') = qd.digits
    )
  limit 1;
$$;

revoke all on function public.resolve_app_user_id_from_phone_e164(text) from public;
grant execute on function public.resolve_app_user_id_from_phone_e164(text) to anon, authenticated;

create or replace function public.has_profile_for_phone_e164(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    with q as (select trim(coalesce(p_phone, '')) as raw),
    qd as (select raw, regexp_replace(raw, '[^0-9]', '', 'g') as digits from q)
    select 1
    from public.profiles pr, qd
    where coalesce(pr.is_withdrawn, false) = false
      and (
        pr.phone = qd.raw
        or regexp_replace(coalesce(pr.phone, ''), '[^0-9]', '', 'g') = qd.digits
      )
  );
$$;

revoke all on function public.has_profile_for_phone_e164(text) from public;
grant execute on function public.has_profile_for_phone_e164(text) to anon, authenticated;

notify pgrst, 'reload schema';

