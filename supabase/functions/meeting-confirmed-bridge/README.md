# `meeting-confirmed-bridge`

Supabase `integration_outbox`에 쌓인 `firestore_chat_system_place_confirmed` 이벤트를 소비해,  
Firestore `meetings/{legacy_firestore_meeting_id}/messages`에 **시스템 메시지**를 씁니다.

## 배포 전제

1. SQL 마이그레이션 `0004_hybrid_outbox_ranking_realtime.sql` 적용.
2. Supabase Secrets (또는 Edge 환경변수):
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — Firebase 서비스 계정 JSON **문자열 전체**
   - (선택) `SUPABASE_SERVICE_ROLE_KEY` — outbox를 직접 읽고 `processed_at`을 찍을 때

## Outbox 페이로드 (`kind = firestore_chat_system_place_confirmed`)

`0004` 트리거가 넣는 `payload` JSON 예:

```json
{
  "legacy_firestore_meeting_id": "<Firestore meetings 문서 id>",
  "place_name": "...",
  "schedule_date": "...",
  "schedule_time": "..."
}
```

Edge 처리 순서(권장):

1. `SUPABASE_SERVICE_ROLE_KEY`로 `integration_outbox`에서 `processed_at is null` 행 조회(또는 Webhook으로 단건 수신).
2. `kind` 검사 후 Firebase Admin으로 `meetings/{legacy_firestore_meeting_id}/messages`에 문서 추가.  
   예: `{ kind: 'system', text: '장소·일정이 확정되었습니다.', createdAt: FieldValue.serverTimestamp(), ... }` — **실제 필드명은 앱 `meeting-chat` 송신부와 동일하게** 맞출 것.
3. 성공 시 해당 outbox 행의 `processed_at` 갱신. 실패 시 `last_error`에 메시지 저장.

## 구현 메모

- Deno Edge에서 `firebase-admin` npm 패키지 사용 가능 (`import admin from "npm:firebase-admin@12"` 등).
- 메시지 필드는 앱의 `meeting-chat`과 동일하게 `kind: 'system'`, `text`, `createdAt` 등을 맞춥니다.
- `index.ts`는 **폴링 소비기**로 구현되어 있습니다: `POST` 시 미처리 `firestore_chat_system_place_confirmed` 행을 최대 25건 처리하고 Firestore에 시스템 메시지를 추가합니다. 배포 후 **스케줄 호출**(예: 분 단위) 또는 Database Webhook에서 동일 엔드포인트를 호출하세요.

## 트리거 방식 대안

- Supabase **Database Webhook** → 별도 Cloud Run / Vercel에서 Firestore 쓰기.
- 또는 **스케줄 Edge Function**이 `processed_at is null` 행을 폴링.
