-- Edge `fcm-push-send` 가 profiles 를 `app_user_id IN (...)` 만 조회하면,
-- `meeting_share_notify_host_web_guest_fcm` 이 보내는 `toUserIds`(ginit_normalize_app_user_id 적용 값)와
-- DB `profiles.app_user_id` 표기(레거시 공백·이메일 대소문자 등)가 어긋날 때 토큰 0건 → FCM 미발송이 됩니다.
-- `meeting_share_guest_get_host_profile`(0080) 과 동일하게 양쪽에 normalize 를 적용합니다.

create or replace function public.fcm_push_list_profile_tokens_for_user_ids(p_app_user_ids text[])
returns table (fcm_token text, fcm_platform text)
language sql
security definer
set search_path = public
stable
as $$
  select p.fcm_token::text, coalesce(nullif(trim(p.fcm_platform::text), ''), 'legacy')::text
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
