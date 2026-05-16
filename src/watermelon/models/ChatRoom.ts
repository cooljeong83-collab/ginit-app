import type { Query } from '@nozbe/watermelondb';
import { Model, associations } from '@nozbe/watermelondb';
import { children, field } from '@nozbe/watermelondb/decorators';

import type { ChatMessage } from './ChatMessage';

export class ChatRoom extends Model {
  static table = 'chat_rooms' as const;

  static override associations = associations(['chat_messages', { type: 'has_many', foreignKey: 'chat_room_id' }]);

  @field('room_id') roomId!: string;
  @field('room_type') roomType!: string;
  @field('owner_user_id') ownerUserId!: string | null;
  @field('peer_user_id') peerUserId!: string | null;
  @field('is_group') isGroup!: boolean | null;

  @field('last_synced_at_ms') lastSyncedAtMs!: number | null;
  @field('last_synced_changed_at_ms') lastSyncedChangedAtMs!: number | null;
  @field('backfill_cursor_created_at_ms') backfillCursorCreatedAtMs!: number | null;
  @field('last_pruned_at_ms') lastPrunedAtMs!: number | null;
  @field('local_message_count') localMessageCount!: number | null;
  @field('last_message_at_ms') lastMessageAtMs!: number | null;
  @field('last_message_id') lastMessageId!: string | null;
  @field('last_message_preview') lastMessagePreview!: string | null;
  @field('last_message_kind') lastMessageKind!: string | null;
  @field('last_sender_id') lastSenderId!: string | null;
  @field('last_sender_name') lastSenderName!: string | null;
  @field('last_sender_avatar_url') lastSenderAvatarUrl!: string | null;
  @field('unread_count') unreadCount!: number | null;
  @field('unread_last_at_ms') unreadLastAtMs!: number | null;
  @field('read_message_id') readMessageId!: string | null;
  @field('read_at_ms') readAtMs!: number | null;
  @field('message_read_message_id_by_json') messageReadMessageIdByJson!: string | null;
  @field('message_read_at_by_json') messageReadAtByJson!: string | null;
  @field('message_read_last_seq_by_json') messageReadLastSeqByJson!: string | null;
  @field('message_read_state_last_at_ms') messageReadStateLastAtMs!: number | null;
  @field('remote_updated_at_ms') remoteUpdatedAtMs!: number | null;
  @field('room_search_text') roomSearchText!: string | null;
  /** Supabase `chat_messages.seq` 마지막 적용값 — 메시지 델타·동기화 커서 */
  @field('last_server_seq') lastServerSeq!: number | null;
  /** 백필 다음 페이지 `p_before_seq` */
  @field('backfill_before_server_seq') backfillBeforeServerSeq!: number | null;
  /** 내가 읽은 마지막 서버 seq — 읽음·동기화용(목록 미읽음은 `unread_count`만 사용) */
  @field('last_read_server_seq') lastReadServerSeq!: number | null;
  @field('pending_read_last_seq') pendingReadLastSeq!: number | null;
  @field('pending_read_message_id') pendingReadMessageId!: string | null;
  @field('pending_read_at_ms') pendingReadAtMs!: number | null;

  @children('chat_messages') messages!: Query<ChatMessage>;
}

