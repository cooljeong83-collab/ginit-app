-- Edge `fcm-push-send`가 수신자별 알림음(iOS aps.sound / Android notification channel)을 맞추도록
-- `profiles.metadata->>'notification_sound'`를 토큰 조회에 포함합니다.
-- 클라이언트는 설정 저장 시 `upsert_profile_payload`의 `metadata_patch`로 동일 키를 갱신합니다.

drop function if exists public.fcm_push_list_profile_tokens_for_user_ids(text[]);

create or replace function public.fcm_push_list_profile_tokens_for_user_ids(p_app_user_ids text[])
returns table (fcm_token text, fcm_platform text, notification_sound text)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.fcm_token::text,
    coalesce(nullif(trim(p.fcm_platform::text), ''), 'legacy')::text,
    nullif(trim(coalesce(p.metadata->>'notification_sound', '')), '')::text
  from public.profiles p
  where coalesce(p.is_withdrawn, false) = false
    and coalesce(trim(p.fcm_token), '') <> ''
    and exists (
      select 1
      from unnest(coalesce(p_app_user_ids, array[]::text[])) as q(raw_id)
      where public.ginit_normalize_app_user_id(p.app_user_id)
        = public.ginit_normalize_app_user_id(trim(q.raw_id))
    );
$$;

revoke all on function public.fcm_push_list_profile_tokens_for_user_ids(text[]) from public;
grant execute on function public.fcm_push_list_profile_tokens_for_user_ids(text[]) to service_role;

notify pgrst, 'reload schema';
