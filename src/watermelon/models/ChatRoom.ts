import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class ChatRoom extends Model {
  static table = 'chat_rooms' as const;

  @field('room_id') roomId!: string;
  @field('room_type') roomType!: string;
  @field('peer_user_id') peerUserId!: string | null;

  @field('last_synced_at_ms') lastSyncedAtMs!: number | null;
  @field('last_message_at_ms') lastMessageAtMs!: number | null;
  @field('last_message_id') lastMessageId!: string | null;
}

