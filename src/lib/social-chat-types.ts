import type { Timestamp } from '@/src/lib/ginit-timestamp';
import type { MeetingChatLinkPreview, MeetingChatMessageKind } from '@/src/lib/meeting-chat';
import { sanitizeUnicodeForSqliteStorage } from '@/src/lib/offline-chat/offline-chat-utils';

export type SocialChatRoomDoc = {
  id: string;
  isGroup?: boolean;
  participantIds?: string[];
  readMessageIdBy?: Record<string, string | null | undefined>;
  readAtBy?: Record<string, unknown>;
  unreadCountBy?: Record<string, number | null | undefined>;
  updatedAt?: unknown | null;
};

export type SocialChatReplyTo = {
  messageId: string;
  senderId: string | null;
  kind?: MeetingChatMessageKind;
  imageUrl?: string | null;
  text: string;
};

export type SocialChatMessage = {
  id: string;
  serverSeq?: number;
  clientMutationId?: string | null;
  senderId: string | null;
  senderName?: string;
  senderAvatarUrl?: string | null;
  text: string;
  kind?: MeetingChatMessageKind;
  imageUrl?: string | null;
  imageAlbumBatchId?: string | null;
  linkPreview?: MeetingChatLinkPreview | null;
  replyTo?: SocialChatReplyTo | null;
  createdAt: Timestamp | null;
  updatedAt?: Timestamp | null;
  deletedAt?: Timestamp | null;
};

export type SocialChatRoomSummary = {
  roomId: string;
  peerAppUserId: string;
};

/** 친구 DM `chat_rooms.id` — 모임 RPC에 넘기면 `meeting_not_found`. */
export function isSocialDmChatRoomId(roomId: string): boolean {
  return String(roomId ?? '').trim().startsWith('social_');
}

export function socialDmPreviewLine(m: SocialChatMessage | null | undefined): string {
  const t = m?.text?.trim();
  if (t) {
    const clipped = t.length > 100 ? `${t.slice(0, 100)}…` : t;
    return sanitizeUnicodeForSqliteStorage(clipped);
  }
  return '새 메시지';
}
