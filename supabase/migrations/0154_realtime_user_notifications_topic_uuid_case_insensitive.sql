-- `user_notifications:{profiles.id}` Broadcast RLS: 토픽 접미사와 `profiles.id::text` 대소문자 불일치 시
-- Realtime private 채널이 Unauthorized로 거절되는 경우를 방지합니다.

do $policy$
begin
  if to_regclass('realtime.messages') is null then
    raise notice '0154: realtime.messages 없음 — Realtime Authorization 스킵';
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
      and lower(nullif(
        trim(substring(
          (select realtime.topic())
          from (char_length('user_notifications:') + 1)
        )),
        ''
      )) = (
        select lower(p.id::text)
        from public.profiles p
        where p.auth_user_id = auth.uid()
        limit 1
      )
    );
  $sql$;
end
$policy$;

notify pgrst, 'reload schema';
