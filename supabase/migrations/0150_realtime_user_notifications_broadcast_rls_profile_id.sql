-- `user_notifications:{profiles.id}` Broadcast 수신 RLS.
-- 토픽 접미사는 public.profiles PK(UUID)이며, 로그인 사용자의 `profiles.id`와 일치할 때만 수신합니다.
-- (이전: `user_notifications:{app_user_id}` — 이메일·전화 PK가 Realtime 토픽에 노출됨)

do $policy$
begin
  if to_regclass('realtime.messages') is null then
    raise notice '0150: realtime.messages 없음 — Realtime Authorization 스킵';
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
        trim(substring(
          (select realtime.topic())
          from (char_length('user_notifications:') + 1)
        )),
        ''
      ) = (
        select p.id::text
        from public.profiles p
        where p.auth_user_id = auth.uid()
        limit 1
      )
    );
  $sql$;
end
$policy$;

notify pgrst, 'reload schema';
