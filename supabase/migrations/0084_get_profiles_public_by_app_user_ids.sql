-- 배치 공개 프로필 조회: N회 get_profile_public_by_app_user_id 대신 1회 조회.
-- 반환: { "app_user_id": <profiles 행 to_jsonb와 동일>, ... }

create or replace function public.get_profiles_public_by_app_user_ids(p_app_user_ids text[])
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select jsonb_object_agg(p.app_user_id, to_jsonb(p))
      from public.profiles p
      where p.app_user_id in (
        select distinct trim(x)
        from unnest(coalesce(p_app_user_ids, array[]::text[])) as t(x)
        where trim(x) is not null
          and trim(x) <> ''
      )
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.get_profiles_public_by_app_user_ids(text[]) from public;
grant execute on function public.get_profiles_public_by_app_user_ids(text[]) to anon, authenticated;

notify pgrst, 'reload schema';
