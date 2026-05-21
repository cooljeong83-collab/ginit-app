# 공지 시스템 — 앱 연동 (PART 2)

운영 공지(`notices` / `user_notifications`)는 레거시 고객센터 공지(`app_announcements`, `/support/announcements`)와 **별도**입니다.

## 이름 구분 (필수)

| 이름 | 의미 |
|------|------|
| DB `public.user_notifications` | 공지 **수신함** 테이블 |
| Realtime `user_notifications:{profiles.id}` | **채팅** Broadcast 토픽 — 수신함 테이블과 무관 |

## 앱용 RPC (migration `0227_notices_app_public_rpc.sql`)

| RPC | 용도 |
|-----|------|
| `list_active_notices_for_me(p_channel)` | `home_banner` \| `popup` |
| `list_my_notice_inbox(p_limit, p_cursor)` | 수신함 목록 |
| `count_my_notice_inbox_unread()` | 설정 알림함 배지 |
| `mark_notice_inbox_read(p_inbox_id)` | 읽음 (inbox row) |
| `mark_notice_inbox_read_by_notice_id(p_notice_id)` | 읽음 (FCM·상세) |
| `get_notice_detail_for_me(p_notice_id)` | 상세 |

Direct `select` on `notices` / `user_notifications` 금지 (RLS revoke).

## FCM data (admin `is_push_alarm`)

```json
{
  "type": "notice",
  "notice_id": "<uuid>",
  "link_url": "<string or empty>"
}
```

- 탭 시: `push-open-navigation` → `link_url` 또는 `/notices/{id}`
- 읽음: `mark_notice_inbox_read_by_notice_id`

## 화면 진입점

| 경로 | 설명 |
|------|------|
| 홈 상단 | `HomeNoticeBanner` (`list_active_notices_for_me('home_banner')`) |
| 앱 전역 | `NoticePopupGate` (`popup` 채널) |
| 설정 > 알림함 | `/notices/inbox` |
| 공지 상세 | `/notices/[id]` |
| 설정 > 공지사항 (레거시) | `/support/announcements` — `app_announcements` |

## 클라이언트 모듈

- `src/features/notices/notices-api.ts`
- `src/hooks/use-active-notices-query.ts` 등
- TanStack 키 루트: `['notices', ...]`

## 수동 테스트 체크리스트

1. admin `admin_preview` + 홈 배너 → 관리자 앱 계정만 배너/팝업
2. `all` + popup + image + push → FCM, 팝업, inbox 적재
3. `region` + seoul → `base_region` 일치 유저만
4. `end_at` 지난 공지 미노출
5. 푸시 탭 → `link_url` 또는 `/notices/{id}`, inbox 읽음 처리
