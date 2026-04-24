-- 프로필 공개 조회 RPC — PostgREST 스키마 캐시에 안 잡힐 때 재적용(0007과 동일 본문).

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

notify pgrst, 'reload schema';
