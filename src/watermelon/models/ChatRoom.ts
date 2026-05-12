import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class ChatRoom extends Model {
  static table = 'chat_rooms' as const;

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
  @field('message_read_state_last_at_ms') messageReadStateLastAtMs!: number | null;
  @field('remote_updated_at_ms') remoteUpdatedAtMs!: number | null;
  @field('room_search_text') roomSearchText!: string | null;
}

