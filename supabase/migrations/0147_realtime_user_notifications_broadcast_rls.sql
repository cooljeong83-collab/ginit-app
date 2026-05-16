-- 채널 `user_notifications:{profiles.app_user_id}` — Broadcast(private) 수신 RLS.
-- 클라이언트: supabase.channel('user_notifications:'+appUserId, { config: { private: true } })
-- Dashboard Realtime 설정에서 private 채널·Authorization 사용을 권장합니다.

do $policy$
begin
  if to_regclass('realtime.messages') is null then
    raise notice '0147: realtime.messages 없음 — Realtime Authorization 스킵';
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
      and (select realtime.topic()) =
        'user_notifications:' || nullif(
          trim(coalesce(
            (select p.app_user_id from public.profiles p where p.auth_user_id = auth.uid() limit 1),
            ''
          )),
          ''
        )
    );
  $sql$;
end
$policy$;

notify pgrst, 'reload schema';
