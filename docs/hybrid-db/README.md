## 하이브리드 DB 전환 가이드 (Supabase + Firestore)

### 목표
- **Supabase(Postgres)**: 정본(Source of Truth) + 수치 계산/무결성/복잡 쿼리
- **Firestore**: 채팅/알림/투표 등 **실시간 UI**를 위한 신경망

### 데이터 분리 원칙(현재 레포 기준)
- **Supabase로 이관(정적/정본)**
  - 사용자: 닉네임/프로필, 성별·연령대, 전화 인증 여부, G-Level/G-Trust/XP, 성향(G-DNA)
  - 모임(확정/조회용): 확정된 일정/장소, 카테고리, 공개 여부, 정원 등
  - 포인트·XP 기록(ledger)
- **Firestore 유지(실시간)**
  - 모임 채팅: `meetings/{meetingId}/messages`
  - 인앱/푸시 알림: 실시간 “신호/이벤트” 문서
  - 조율 중 투표/접속 상태: 실시간 반응이 필요한 문서

### 키/식별자 권장
현재 앱은 `userId`를 **문자열**(정규화 이메일 또는 전화 PK)로 사용합니다.
- **권장**: Supabase에도 `app_user_id TEXT UNIQUE`를 두어 기존 코드와 호환
- 장기적으로는 `auth_user_id UUID (auth.users.id)`로 통일하고 `app_user_id`는 alias로 유지/점진 제거

### Write 브리지(권장 패턴)
1) **Supabase에 먼저 기록** (INSERT/UPDATE/RPC)  
2) 성공 시 **Firestore에는 “신호 문서”만** 기록 (UI/알림 트리거)

중복·재시도 대비:
- Firestore 신호 문서에는 `dedupeKey`를 포함(예: `${meetingId}:${userId}:${eventKind}:${roundId}`)
- Supabase는 `xp_events` 같은 원장 테이블로 **idempotent** 처리(유니크 키/제약)

### 초기 스키마/마이그레이션
- `supabase/migrations/0001_hybrid_init.sql` 참고

