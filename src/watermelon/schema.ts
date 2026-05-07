import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * 테이블을 추가할 때 `tableSchema`로 정의하고 `version`을 올리세요.
 * @see https://watermelondb.dev/docs/Schema
 */
export const schema = appSchema({
  version: 2,
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
        { name: 'peer_user_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'last_synced_at_ms', type: 'number', isOptional: true },
        { name: 'last_message_at_ms', type: 'number', isOptional: true, isIndexed: true },
        { name: 'last_message_id', type: 'string', isOptional: true },
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
        { name: 'sender_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'sender_name', type: 'string', isOptional: true },
        { name: 'sender_avatar_url', type: 'string', isOptional: true },
        { name: 'kind', type: 'string', isOptional: true, isIndexed: true }, // text | image | system
        { name: 'text', type: 'string', isOptional: true },
        { name: 'image_url', type: 'string', isOptional: true },
        { name: 'reply_to_message_id', type: 'string', isOptional: true },
        { name: 'search_text', type: 'string', isOptional: true, isIndexed: true },
        { name: 'is_deleted', type: 'boolean', isOptional: true },
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
  ],
});
