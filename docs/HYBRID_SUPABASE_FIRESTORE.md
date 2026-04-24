# 지닛(Ginit) 하이브리드 백엔드: Supabase + Firestore

**연결 키(`app_user_id`)** — Firebase Auth UID가 아니라, 앱 전역에서 쓰는 사용자 PK(정규화 이메일·전화 PK 등)를 Firestore `users` 문서 ID와 Supabase `profiles.app_user_id`에 **동일 문자열**로 둡니다. 채팅·알림의 `senderId` / `userId`도 이 값을 사용하면 두 DB가 끊기지 않습니다.

---

## 1. 역할 분담 (Architecture Strategy)

| 영역 | 저장소 | 설명 |
|------|--------|------|
| 사용자 프로필, 레벨/XP/신뢰, 랭킹 포인트, 약관·전화 메타 | **Supabase `profiles`** | 정합성·집계·SQL 쿼리 |
| 확정 모임 스냅샷(피드·지도·필터) | **Supabase `meetings`** + `meeting_participants` | `legacy_firestore_id` ↔ Firestore `meetings/{id}` |
| 모임 초안·투표·후보·실시간 스냅샷 | **Firestore `meetings`** | 기존 앱 로직 유지, 확정 시 Supabase 동기화 |
| 채팅 메시지 | **Firestore `meetings/{meetingId}/messages`** | 실시간 리스너 (`subscribeMeetingChatMessages`) |
| 알림 신호(푸시·인앱 배지) | **Firestore `notifications`** (권장) | `src/lib/notifications-firestore.ts` — `userId` = `app_user_id` |
| 카테고리 마스터 | **Supabase `meeting_categories`** (기본, Supabase 구성 시) · 레거시 Firestore `categories`는 `EXPO_PUBLIC_CATEGORIES_SOURCE=firestore` |

> 스펙의 `chat_rooms` 명칭과의 대응: 논리적 채팅방 = Firestore **`meetings/{meetingId}`** 문서이며, 메시지는 하위 **`messages`** 서브컬렉션입니다. 별도 `chat_rooms` 컬렉션을 두지 않아도 동일 패턴입니다.

---

## 2. Auth 연동 (Firebase vs Supabase Auth)

**현행(1단계)**: Firebase Auth(전화 OTP / Google) 유지. Supabase는 **Anon + RPC(`security definer`)** 또는 **Service Role(서버/Edge)** 로 `profiles`를 읽고 씁니다.

- **`EXPO_PUBLIC_PROFILE_SOURCE=supabase`**: 클라이언트 `getUserProfile`이 RPC `get_profile_public_by_app_user_id`로 조회 (`0007_profile_public_read_rpc.sql`).
- **2단계(선택)**: Supabase Auth 도입 시 `profiles.auth_user_id`를 채우고 RLS를 `auth.uid()` 기반으로 이전.

---

## 3. 클라이언트 조회 스위치 (환경 변수)

| 변수 | 값 | 동작 |
|------|-----|------|
| `EXPO_PUBLIC_MEETING_LIST_SOURCE` | `supabase` | 공개 모임 목록: `subscribeMeetingsHybrid` → Supabase Realtime (`supabase-meetings-list.ts`) |
| `EXPO_PUBLIC_PROFILE_SOURCE` | `supabase` | `getUserProfile` → Supabase RPC (마이그레이션 `0007` 필요) |
| `EXPO_PUBLIC_CATEGORIES_SOURCE` | _(비움·기본)_ 또는 `firestore` | 기본: Supabase `meeting_categories` (`0006`). Firestore만 쓸 때 `firestore` |

채팅 메시지 목록은 **항상 Firestore** 리스너를 유지합니다.

---

## 4. 실시간·알림 (Firestore 유지)

- **채팅**: 기존 경로 유지. 참가자 ID는 이미 `participantIds`(앱 PK) — Supabase `meeting_participants.profile_id`와 맞출 때는 `profiles.app_user_id`로 조인 설계.
- **알림**: Edge / Cloud Function / 클라이언트(주의: 보안)에서 `notifications`에 문서 생성 시 `userId` = **`app_user_id`**. Firestore 콘솔에서 `userId` + `createdAt` 복합 인덱스가 필요할 수 있습니다.

---

## 5. 마이그레이션 스크립트

| 스크립트 | 용도 |
|----------|------|
| `npm run migrate:profiles:firestore-to-supabase` | `users` → `profiles` upsert |
| `npm run migrate:categories:firestore-to-supabase` | `categories` → `meeting_categories` |
| `npm run print:categories-sql` | 카테고리 INSERT SQL 생성 |

서비스 계정·`SUPABASE_SERVICE_ROLE_KEY`는 **로컬/CI만**, 앱 번들에 넣지 않습니다.

---

## 6. Event Bridge — 모임 확정 → Firestore 시스템 메시지

1. **DB 트리거** (`0004_hybrid_outbox_ranking_realtime.sql`): Supabase `meetings.schedule_confirmed`가 `false` → `true`이고 `legacy_firestore_id`가 있으면 `integration_outbox`에 `kind = firestore_chat_system_place_confirmed` 행 삽입.
2. **소비기**: Supabase Edge **`meeting-confirmed-bridge`** (현재 스텁) 또는 Database Webhook → Firebase Admin으로  
   `meetings/{legacy_firestore_meeting_id}/messages` 에 `kind: 'system'` 문서 추가 후 `processed_at` 처리.

자세한 시크릿·페이로드: `supabase/functions/meeting-confirmed-bridge/README.md`

---

## 7. 체크리스트

- [ ] `0001`~`0007` 마이그레이션 적용 순서 확인  
- [ ] `profiles` / `meetings` 백필 및 `legacy_firestore_id` 정합  
- [ ] Edge에서 시스템 메시지 스키마를 `meeting-chat`과 동일하게 맞추기  
- [ ] `notifications` 복합 인덱스 및 쓰기 경로(서버만) 확정  
- [ ] 스테이징에서 `EXPO_PUBLIC_*_SOURCE=supabase` 검증 후 프로덕션 전환  

UI·브랜딩(지닛 시각적 아이덴티티)은 **데이터 소스와 독립**입니다.
