-- `global_user_sync:{profiles.id}` — private 채널에서 `postgres_changes`(chat_room_participants·friends) 수신 RLS.
-- Broadcast는 `user_notifications:{profiles.id}` 정책(0154)을 그대로 사용합니다.

do $policy$
begin
  if to_regclass('realtime.messages') is null then
    raise notice '0160: realtime.messages 없음 — Realtime Authorization 스킵';
    return;
  end if;

  execute $sql$
    drop policy if exists "realtime_messages_select_global_user_sync_postgres" on realtime.messages;
    -- 채널 join 시 extension 컨텍스트가 비어 있을 수 있어, 토픽·본인 profiles.id 일치만 검사합니다.
    -- (postgres_changes 본문 전달은 public.chat_room_participants / friends 테이블 RLS가 담당)
    create policy "realtime_messages_select_global_user_sync_postgres"
    on realtime.messages
    for select
    to authenticated
    using (
      (select realtime.topic()) like 'global_user_sync:%'
      and lower(nullif(
        trim(substring(
          (select realtime.topic())
          from (char_length('global_user_sync:') + 1)
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
