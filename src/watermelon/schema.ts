import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * 테이블을 추가할 때 `tableSchema`로 정의하고 `version`을 올리세요.
 * @see https://watermelondb.dev/docs/Schema
 */
export const schema = appSchema({
  version: 17,
  tables: [
    /**
     * 채팅방 메타(증분 동기화 커서/상태).
     * - Firestore Read 비용 절감 포인트: lastSyncedAt 이후만 pull
     */
    tableSchema({
      name: 'chat_rooms',
      columns: [
        { name: 'room_id', type: 'string', isIndexed: true },
        { name: 'room_type', type: 'string', isIndexed: true }, // 'meeting' | 'social_dm'
        { name: 'owner_user_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'peer_user_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'is_group', type: 'boolean', isOptional: true },
        { name: 'last_synced_at_ms', type: 'number', isOptional: true },
        { name: 'last_synced_changed_at_ms', type: 'number', isOptional: true },
        { name: 'backfill_cursor_created_at_ms', type: 'number', isOptional: true },
        { name: 'last_pruned_at_ms', type: 'number', isOptional: true },
        { name: 'local_message_count', type: 'number', isOptional: true },
        { name: 'last_message_at_ms', type: 'number', isOptional: true, isIndexed: true },
        { name: 'last_message_id', type: 'string', isOptional: true },
        { name: 'last_message_preview', type: 'string', isOptional: true },
        { name: 'last_message_kind', type: 'string', isOptional: true, isIndexed: true },
        { name: 'last_sender_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'last_sender_name', type: 'string', isOptional: true },
        { name: 'last_sender_avatar_url', type: 'string', isOptional: true },
        { name: 'unread_count', type: 'number', isOptional: true },
        { name: 'unread_last_at_ms', type: 'number', isOptional: true, isIndexed: true },
        { name: 'read_message_id', type: 'string', isOptional: true },
        { name: 'read_at_ms', type: 'number', isOptional: true },
        { name: 'message_read_message_id_by_json', type: 'string', isOptional: true },
        { name: 'message_read_at_by_json', type: 'string', isOptional: true },
        { name: 'message_read_last_seq_by_json', type: 'string', isOptional: true },
        { name: 'message_read_state_last_at_ms', type: 'number', isOptional: true, isIndexed: true },
        { name: 'remote_updated_at_ms', type: 'number', isOptional: true, isIndexed: true },
        { name: 'room_search_text', type: 'string', isOptional: true, isIndexed: true },
        /** Supabase `chat_pull_deltas` 커서 (0135). Firestore 경로에서는 미사용 */
        { name: 'last_server_seq', type: 'number', isOptional: true, isIndexed: true },
        /** Supabase 백필: 다음 `chat_pull_history_before_seq` 의 p_before_seq */
        { name: 'backfill_before_server_seq', type: 'number', isOptional: true, isIndexed: true },
        /** 내가 마지막으로 읽은 `chat_messages.server_seq` (미읽음 = last_server_seq - last_read_server_seq) */
        { name: 'last_read_server_seq', type: 'number', isOptional: true, isIndexed: true },
        /** 오프라인 읽음 — 서버 `chat_mark_read` 재시도 대기 seq */
        { name: 'pending_read_last_seq', type: 'number', isOptional: true, isIndexed: true },
        { name: 'pending_read_message_id', type: 'string', isOptional: true },
        { name: 'pending_read_at_ms', type: 'number', isOptional: true },
      ],
    }),

    /**
     * 메시지 로컬 저장 (Denormalized sender info 포함).
     * - 검색 성능: search_text를 별도로 만들어 인덱싱(FTS 가능 구조)
     * - Firestore Read 절감: 검색 결과 렌더링에 프로필 read가 필요 없도록 sender_*를 보관
     */
    tableSchema({
      name: 'chat_messages',
      columns: [
        { name: 'room_id', type: 'string', isIndexed: true },
        { name: 'room_type', type: 'string', isIndexed: true },
        { name: 'message_id', type: 'string', isIndexed: true },
        { name: 'created_at_ms', type: 'number', isIndexed: true },
        { name: 'updated_at_ms', type: 'number', isOptional: true, isIndexed: true },
        { name: 'deleted_at_ms', type: 'number', isOptional: true, isIndexed: true },
        { name: 'sender_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'sender_name', type: 'string', isOptional: true },
        { name: 'sender_avatar_url', type: 'string', isOptional: true },
        { name: 'kind', type: 'string', isOptional: true, isIndexed: true }, // text | image | system
        { name: 'text', type: 'string', isOptional: true },
        { name: 'image_url', type: 'string', isOptional: true },
        { name: 'image_album_batch_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'reply_to_message_id', type: 'string', isOptional: true },
        { name: 'reply_to_json', type: 'string', isOptional: true },
        { name: 'link_preview_json', type: 'string', isOptional: true },
        { name: 'raw_payload_json', type: 'string', isOptional: true },
        { name: 'search_text', type: 'string', isOptional: true, isIndexed: true },
        { name: 'is_deleted', type: 'boolean', isOptional: true },
        /** Supabase `chat_messages.seq` (델타·백필 커서) */
        { name: 'server_seq', type: 'number', isOptional: true, isIndexed: true },
        /** Supabase `chat_messages.client_mutation_id` — RPC 멱등·낙관적 전송 매칭 */
        { name: 'client_mutation_id', type: 'string', isOptional: true, isIndexed: true },
        /** Watermelon `chat_rooms.id` FK — @children / 파티션 무관 로컬 관계 */
        { name: 'chat_room_id', type: 'string', isOptional: true, isIndexed: true },
        /** 내가 해당 메시지까지 읽음(방 진입·읽음 처리 시 로컬 즉시 반영) */
        { name: 'is_read', type: 'boolean', isOptional: true, isIndexed: true },
      ],
    }),

    /**
     * 최근 검색어 (로컬 전용).
     * - Firestore Read 0: 서버 저장 금지(개인 UX 데이터)
     */
    tableSchema({
      name: 'recent_searches',
      columns: [
        { name: 'scope', type: 'string', isIndexed: true }, // 'room' | 'global'
        { name: 'room_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'query', type: 'string', isIndexed: true },
        { name: 'last_used_at_ms', type: 'number', isIndexed: true },
        { name: 'use_count', type: 'number', isOptional: true },
      ],
    }),

    /**
     * (개념) Firestore Search Index Chunk를 로컬에 캐싱하는 테이블.
     * - 사용자가 검색할 때 로컬 데이터가 부족하면, 서버의 chunk를 필요한 만큼만 읽어서 backfill
     */
    tableSchema({
      name: 'chat_search_index_chunks',
      columns: [
        { name: 'room_id', type: 'string', isIndexed: true },
        { name: 'room_type', type: 'string', isIndexed: true },
        { name: 'chunk_id', type: 'string', isIndexed: true }, // 예: '2026-05-01_0'
        { name: 'range_start_at_ms', type: 'number', isOptional: true, isIndexed: true },
        { name: 'range_end_at_ms', type: 'number', isOptional: true, isIndexed: true },
        { name: 'chunk_text', type: 'string' },
        { name: 'fetched_at_ms', type: 'number', isOptional: true },
      ],
    }),

    /** 모임 카테고리 마스터 오프라인 캐시(Supabase/Firestore 동기화 후 스냅샷). */
    tableSchema({
      name: 'cached_meeting_categories',
      columns: [
        { name: 'label', type: 'string' },
        { name: 'emoji', type: 'string' },
        { name: 'sort_order', type: 'number', isIndexed: true },
        { name: 'major_code', type: 'string', isOptional: true },
      ],
    }),

    /** 모임 상세 단건 스냅샷(`Meeting` JSON). id = 앱 meeting id. */
    tableSchema({
      name: 'cached_meeting_details',
      columns: [
        { name: 'meeting_json', type: 'string' },
        { name: 'synced_at_ms', type: 'number', isIndexed: true },
      ],
    }),

    /** 사용자 프로필 스냅샷(`UserProfile` JSON). id = `app_user_id`. */
    tableSchema({
      name: 'cached_user_profiles',
      columns: [
        { name: 'profile_json', type: 'string' },
        { name: 'synced_at_ms', type: 'number', isIndexed: true },
      ],
    }),

    /** Supabase `places` 경량 캐시 — 장소 후보 검색 로컬 히트 */
    tableSchema({
      name: 'places_cache',
      columns: [
        { name: 'place_key', type: 'string', isIndexed: true },
        { name: 'server_place_id', type: 'string', isOptional: true },
        { name: 'place_name', type: 'string', isIndexed: true },
        { name: 'road_address', type: 'string', isIndexed: true },
        { name: 'category', type: 'string', isOptional: true },
        { name: 'latitude', type: 'number', isOptional: true },
        { name: 'longitude', type: 'number', isOptional: true },
        { name: 'preferred_photo_media_url', type: 'string', isOptional: true },
        { name: 'naver_place_link', type: 'string', isOptional: true },
        { name: 'average_rating', type: 'number', isOptional: true },
        { name: 'review_count', type: 'number', isOptional: true },
        { name: 'synced_at_ms', type: 'number', isIndexed: true },
      ],
    }),
  ],
});
