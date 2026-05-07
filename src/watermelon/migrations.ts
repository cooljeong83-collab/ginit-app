import { createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

/**
 * WatermelonDB는 스키마 version 증가 시 migrations가 필요합니다.
 * v1(빈 스키마) -> v2(채팅 오프라인 저장/검색) 마이그레이션.
 */
export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        createTable({
          name: 'chat_rooms',
          columns: [
            { name: 'room_id', type: 'string', isIndexed: true },
            { name: 'room_type', type: 'string', isIndexed: true },
            { name: 'peer_user_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'last_synced_at_ms', type: 'number', isOptional: true },
            { name: 'last_message_at_ms', type: 'number', isOptional: true, isIndexed: true },
            { name: 'last_message_id', type: 'string', isOptional: true },
          ],
        }),
        createTable({
          name: 'chat_messages',
          columns: [
            { name: 'room_id', type: 'string', isIndexed: true },
            { name: 'room_type', type: 'string', isIndexed: true },
            { name: 'message_id', type: 'string', isIndexed: true },
            { name: 'created_at_ms', type: 'number', isIndexed: true },
            { name: 'sender_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'sender_name', type: 'string', isOptional: true },
            { name: 'sender_avatar_url', type: 'string', isOptional: true },
            { name: 'kind', type: 'string', isOptional: true, isIndexed: true },
            { name: 'text', type: 'string', isOptional: true },
            { name: 'image_url', type: 'string', isOptional: true },
            { name: 'reply_to_message_id', type: 'string', isOptional: true },
            { name: 'search_text', type: 'string', isOptional: true, isIndexed: true },
            { name: 'is_deleted', type: 'boolean', isOptional: true },
          ],
        }),
        createTable({
          name: 'recent_searches',
          columns: [
            { name: 'scope', type: 'string', isIndexed: true },
            { name: 'room_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'query', type: 'string', isIndexed: true },
            { name: 'last_used_at_ms', type: 'number', isIndexed: true },
            { name: 'use_count', type: 'number', isOptional: true },
          ],
        }),
        createTable({
          name: 'chat_search_index_chunks',
          columns: [
            { name: 'room_id', type: 'string', isIndexed: true },
            { name: 'room_type', type: 'string', isIndexed: true },
            { name: 'chunk_id', type: 'string', isIndexed: true },
            { name: 'range_start_at_ms', type: 'number', isOptional: true, isIndexed: true },
            { name: 'range_end_at_ms', type: 'number', isOptional: true, isIndexed: true },
            { name: 'chunk_text', type: 'string' },
            { name: 'fetched_at_ms', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
  ],
});

