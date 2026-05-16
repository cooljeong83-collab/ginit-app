import type { Relation } from '@nozbe/watermelondb';
import { Model } from '@nozbe/watermelondb';
import { field, relation } from '@nozbe/watermelondb/decorators';

import type { ChatRoom } from './ChatRoom';

export class ChatMessage extends Model {
  static table = 'chat_messages' as const;

  @field('room_id') roomId!: string;
  @field('room_type') roomType!: string;
  @field('message_id') messageId!: string;
  @field('created_at_ms') createdAtMs!: number;
  @field('updated_at_ms') updatedAtMs!: number | null;
  @field('deleted_at_ms') deletedAtMs!: number | null;

  @field('sender_id') senderId!: string | null;
  @field('sender_name') senderName!: string | null;
  @field('sender_avatar_url') senderAvatarUrl!: string | null;

  @field('kind') kind!: string | null;
  @field('text') text!: string | null;
  @field('image_url') imageUrl!: string | null;
  @field('image_album_batch_id') imageAlbumBatchId!: string | null;
  @field('reply_to_message_id') replyToMessageId!: string | null;
  @field('reply_to_json') replyToJson!: string | null;
  @field('link_preview_json') linkPreviewJson!: string | null;
  @field('raw_payload_json') rawPayloadJson!: string | null;

  /** 검색 최적화용(FTS/LIKE 대상). */
  @field('search_text') searchText!: string | null;

  @field('is_deleted') isDeleted!: boolean | null;
  /** Supabase `chat_messages.seq` */
  @field('server_seq') serverSeq!: number | null;
  @field('client_mutation_id') clientMutationId!: string | null;
  @field('chat_room_id') chatRoomId!: string | null;
  @field('is_read') isRead!: boolean | null;

  @relation('chat_rooms', 'chat_room_id') room!: Relation<ChatRoom>;
}

