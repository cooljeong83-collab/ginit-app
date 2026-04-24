-- Firebase Auth만 쓰는 앱에서 Anon이 `profiles`를 직접 SELECT 할 수 없으므로,
-- 공개 조회용 RPC (security definer)로 app_user_id 기준 프로필 JSON을 반환합니다.
-- `EXPO_PUBLIC_PROFILE_SOURCE=supabase` 시 클라이언트가 사용합니다.

create or replace function public.get_profile_public_by_app_user_id(p_app_user_id text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select to_jsonb(p)
  from public.profiles p
  where p.app_user_id = nullif(trim(p_app_user_id), '')
  limit 1;
$$;

revoke all on function public.get_profile_public_by_app_user_id(text) from public;
grant execute on function public.get_profile_public_by_app_user_id(text) to anon, authenticated;
