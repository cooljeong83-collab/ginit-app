import {
  addColumns,
  createTable,
  schemaMigrations,
  unsafeExecuteSql,
} from '@nozbe/watermelondb/Schema/migrations';

/**
 * WatermelonDB는 스키마 version 증가 시 migrations가 필요합니다.
 * v1 -> v2(채팅 오프라인), v2 -> v3(`cached_meeting_categories`), v7 -> v8(로컬 문자열 NUL 정리).
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
    {
      toVersion: 3,
      steps: [
        createTable({
          name: 'cached_meeting_categories',
          columns: [
            { name: 'label', type: 'string' },
            { name: 'emoji', type: 'string' },
            { name: 'sort_order', type: 'number', isIndexed: true },
            { name: 'major_code', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [
        addColumns({
          table: 'chat_rooms',
          columns: [
            { name: 'last_synced_changed_at_ms', type: 'number', isOptional: true },
            { name: 'backfill_cursor_created_at_ms', type: 'number', isOptional: true },
            { name: 'last_pruned_at_ms', type: 'number', isOptional: true },
            { name: 'local_message_count', type: 'number', isOptional: true },
          ],
        }),
        addColumns({
          table: 'chat_messages',
          columns: [
            { name: 'updated_at_ms', type: 'number', isOptional: true, isIndexed: true },
            { name: 'deleted_at_ms', type: 'number', isOptional: true, isIndexed: true },
            { name: 'image_album_batch_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'reply_to_json', type: 'string', isOptional: true },
            { name: 'link_preview_json', type: 'string', isOptional: true },
            { name: 'raw_payload_json', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 5,
      steps: [
        addColumns({
          table: 'chat_rooms',
          columns: [
            { name: 'owner_user_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'is_group', type: 'boolean', isOptional: true },
            { name: 'last_message_preview', type: 'string', isOptional: true },
            { name: 'last_message_kind', type: 'string', isOptional: true, isIndexed: true },
            { name: 'last_sender_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'last_sender_name', type: 'string', isOptional: true },
            { name: 'last_sender_avatar_url', type: 'string', isOptional: true },
            { name: 'unread_count', type: 'number', isOptional: true },
            { name: 'read_message_id', type: 'string', isOptional: true },
            { name: 'read_at_ms', type: 'number', isOptional: true },
            { name: 'remote_updated_at_ms', type: 'number', isOptional: true, isIndexed: true },
            { name: 'room_search_text', type: 'string', isOptional: true, isIndexed: true },
          ],
        }),
      ],
    },
    {
      toVersion: 6,
      steps: [
        addColumns({
          table: 'chat_rooms',
          columns: [
            { name: 'unread_last_at_ms', type: 'number', isOptional: true, isIndexed: true },
          ],
        }),
      ],
    },
    {
      toVersion: 7,
      steps: [
        addColumns({
          table: 'chat_rooms',
          columns: [
            { name: 'message_read_message_id_by_json', type: 'string', isOptional: true },
            { name: 'message_read_at_by_json', type: 'string', isOptional: true },
            { name: 'message_read_state_last_at_ms', type: 'number', isOptional: true, isIndexed: true },
          ],
        }),
      ],
    },
    {
      toVersion: 8,
      steps: [
        unsafeExecuteSql(
          "update chat_rooms set last_message_preview = replace(last_message_preview, char(0), '') where last_message_preview is not null;",
        ),
        unsafeExecuteSql(
          "update chat_rooms set room_search_text = replace(room_search_text, char(0), '') where room_search_text is not null;",
        ),
        unsafeExecuteSql(
          "update chat_rooms set message_read_message_id_by_json = replace(message_read_message_id_by_json, char(0), '') where message_read_message_id_by_json is not null;",
        ),
        unsafeExecuteSql(
          "update chat_rooms set message_read_at_by_json = replace(message_read_at_by_json, char(0), '') where message_read_at_by_json is not null;",
        ),
        unsafeExecuteSql(
          "update chat_messages set text = replace(text, char(0), '') where text is not null;",
        ),
        unsafeExecuteSql(
          "update chat_messages set search_text = replace(search_text, char(0), '') where search_text is not null;",
        ),
        unsafeExecuteSql(
          "update chat_messages set reply_to_json = replace(reply_to_json, char(0), '') where reply_to_json is not null;",
        ),
        unsafeExecuteSql(
          "update chat_messages set link_preview_json = replace(link_preview_json, char(0), '') where link_preview_json is not null;",
        ),
        unsafeExecuteSql(
          "update chat_messages set raw_payload_json = replace(raw_payload_json, char(0), '') where raw_payload_json is not null;",
        ),
        unsafeExecuteSql("update recent_searches set query = replace(query, char(0), '') where query is not null;"),
        unsafeExecuteSql(
          "update chat_search_index_chunks set chunk_text = replace(chunk_text, char(0), '') where chunk_text is not null;",
        ),
      ],
    },
  ],
});

