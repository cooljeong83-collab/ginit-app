-- user_notifications:{app_user_id} Realtime Broadcast 수신 RLS — app_user_id 대소문자·공백 불일치 허용.
-- 0147 은 profiles.app_user_id 와 topic 을 그대로 비교해 이메일 대소문자만 달라도 CHANNEL_ERROR 가 납니다.

do $policy$
begin
  if to_regclass('realtime.messages') is null then
    raise notice '0149: realtime.messages 없음 — Realtime Authorization 스킵';
    return;
  end if;

  execute $sql$
    drop policy if exists "realtime_messages_select_user_notifications_broadcast" on realtime.messages;
    create policy "realtime_messages_select_user_notifications_broadcast"
    on realtime.messages
    for select
    to authenticated
    using (
      realtime.messages.extension in ('broadcast')
      and (select realtime.topic()) like 'user_notifications:%'
      and nullif(
        public.ginit_normalize_app_user_id(
          substring(
            (select realtime.topic())
            from (char_length('user_notifications:') + 1)
          )
        ),
        ''
      ) is not null
      and public.ginit_normalize_app_user_id(
        substring(
          (select realtime.topic())
          from (char_length('user_notifications:') + 1)
        )
      )
      = public.ginit_normalize_app_user_id(
        (select p.app_user_id from public.profiles p where p.auth_user_id = auth.uid() limit 1)
      )
    );
  $sql$;
end
$policy$;

notify pgrst, 'reload schema';
