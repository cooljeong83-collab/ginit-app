/**
 * Watermelon `query.observe()`는 결과 배열에 남아 있는 행의 컬럼 값만 바뀔 때
 * 이벤트를 내지 않을 수 있음. 목록·미리보기·미읽음 UI는 `observeWithColumns`에
 * 아래 DB 컬럼명(snake_case)을 넘겨야 함.
 * @see @nozbe/watermelondb Query#observeWithColumns
 */
export const WM_CHAT_ROOM_LIST_OBSERVE_COLUMNS = [
  'owner_user_id',
  'peer_user_id',
  'is_group',
  'last_message_at_ms',
  'last_message_id',
  'last_message_preview',
  'last_message_kind',
  'last_sender_id',
  'last_sender_name',
  'last_sender_avatar_url',
  'unread_count',
  'unread_last_at_ms',
  'read_message_id',
  'read_at_ms',
  'remote_updated_at_ms',
  'last_synced_changed_at_ms',
  'last_server_seq',
  'last_read_server_seq',
] as const;

/** 말풍선 `MessageReadCount` 전용: 참가자별 읽음 JSON이 바뀔 때도 emit */
export const WM_CHAT_ROOM_MESSAGE_READ_MAPS_OBSERVE_COLUMNS = [
  'message_read_message_id_by_json',
  'message_read_at_by_json',
  'message_read_last_seq_by_json',
  'message_read_state_last_at_ms',
] as const;

export const WM_CHAT_MESSAGE_LIST_OBSERVE_COLUMNS = [
  'message_id',
  'created_at_ms',
  'updated_at_ms',
  'deleted_at_ms',
  'sender_id',
  'sender_name',
  'sender_avatar_url',
  'kind',
  'text',
  'image_url',
  'image_album_batch_id',
  'reply_to_message_id',
  'reply_to_json',
  'link_preview_json',
  'raw_payload_json',
  'is_deleted',
  'server_seq',
  'client_mutation_id',
  'chat_room_id',
  'is_read',
] as const;

export const WM_CHAT_ROOM_READ_SYNC_OBSERVE_COLUMNS = [
  'last_read_server_seq',
  'pending_read_last_seq',
  'pending_read_message_id',
  'pending_read_at_ms',
] as const;
