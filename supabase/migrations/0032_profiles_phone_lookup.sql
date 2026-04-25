-- Phone(E.164) → app_user_id 조회 RPC.
-- Firestore `users.phone` 역조회(로그인/가입 여부 판단)를 Supabase로 대체합니다.

create or replace function public.resolve_app_user_id_from_phone_e164(p_phone text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pr.app_user_id
  from public.profiles pr
  where pr.phone = trim(p_phone)
    and coalesce(pr.is_withdrawn, false) = false
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
    select 1
    from public.profiles pr
    where pr.phone = trim(p_phone)
      and coalesce(pr.is_withdrawn, false) = false
  );
$$;

revoke all on function public.has_profile_for_phone_e164(text) from public;
grant execute on function public.has_profile_for_phone_e164(text) to anon, authenticated;

notify pgrst, 'reload schema';

