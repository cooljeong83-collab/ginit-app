-- 공개 모임 생성 알림 미수신 점검용 (Supabase SQL Editor, 서비스 롤 또는 postgres)
-- 아래 UUID를 실제 공개 모임 id로 바꿔 실행합니다.

-- 1) 모임 행: 공개 여부·지역 키·카테고리·호스트
-- select id, is_public, feed_region_norm, category_id, created_by_profile_id
-- from public.meetings
-- where id = '00000000-0000-4000-8000-000000000000'::uuid;

-- 2) 구독자 목록 (Edge가 호출하는 RPC와 동일)
-- select * from public.list_app_user_ids_for_meeting_area_notify('00000000-0000-4000-8000-000000000000'::uuid);

-- 3) 호스트 본인은 구독자에서 제외됩니다. 수신 테스트는 «다른 계정» 기기에서 하세요.

-- 4) 단말: 앱에서 EXPO_PUBLIC_GINIT_NOTIFY_DEBUG=1 후 재빌드, logcat/Metro에서 [GinitNotify:meeting-created-notify] 필터.
--    방해금지·skip_no_content 는 [GinitNotify:fcm-notifee-display] / [GinitNotify:FcmMessaging] 로 확인.

-- 5) Edge: Dashboard → Edge Functions → meeting-created-area-notify → Logs (응답 reason: no_subscribers, unauthorized 등)
