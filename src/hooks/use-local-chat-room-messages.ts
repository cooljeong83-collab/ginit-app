import { Q } from '@nozbe/watermelondb';
import { useEffect, useState } from 'react';
import { Timestamp } from '@/src/lib/ginit-timestamp';

import { normalizeMeetingChatLinkPreview } from '@/src/lib/chat-link-preview-normalize';
import type { MeetingChatMessage, MeetingChatMessageKind } from '@/src/lib/meeting-chat';
import type { SocialChatMessage, SocialChatReplyTo } from '@/src/lib/social-chat-rooms';
import { WM_CHAT_MESSAGE_LIST_OBSERVE_COLUMNS } from '@/src/lib/watermelon-observe-columns';
import { database } from '@/src/watermelon';

const DEFAULT_LOCAL_MESSAGE_LIMIT = 1000;

function timestampFromMs(ms: unknown): Timestamp | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Timestamp.fromMillis(ms) : null;
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeKind(v: unknown): MeetingChatMessageKind {
  return v === 'system' ? 'system' : v === 'image' ? 'image' : 'text';
}

function parseLinkPreview(raw: unknown) {
  return normalizeMeetingChatLinkPreview(parseJsonObject(raw));
}

function parseReplyTo(raw: unknown, fallbackMessageId: unknown): MeetingChatMessage['replyTo'] {
  const o = parseJsonObject(raw);
  const messageId =
    typeof o?.messageId === 'string' && o.messageId.trim()
      ? o.messageId.trim()
      : typeof fallbackMessageId === 'string'
        ? fallbackMessageId.trim()
        : '';
  if (!messageId) return null;
  return {
    messageId,
    senderId: typeof o?.senderId === 'string' ? o.senderId : o?.senderId == null ? null : String(o.senderId),
    kind: o?.kind === 'system' ? 'system' : o?.kind === 'image' ? 'image' : o?.kind === 'text' ? 'text' : undefined,
    imageUrl: typeof o?.imageUrl === 'string' ? o.imageUrl : o?.imageUrl == null ? null : String(o.imageUrl ?? ''),
    text: typeof o?.text === 'string' ? o.text : '',
  };
}

function localRowToMeetingMessage(row: any): MeetingChatMessage {
  const rawPayload = parseJsonObject(row.rawPayloadJson);
  const senderName =
    typeof row.senderName === 'string' && row.senderName.trim()
      ? row.senderName.trim()
      : typeof rawPayload?.senderName === 'string' && rawPayload.senderName.trim()
        ? rawPayload.senderName.trim()
        : null;
  const senderAvatarUrl =
    typeof row.senderAvatarUrl === 'string' && row.senderAvatarUrl.trim()
      ? row.senderAvatarUrl.trim()
      : typeof rawPayload?.senderAvatarUrl === 'string' && rawPayload.senderAvatarUrl.trim()
        ? rawPayload.senderAvatarUrl.trim()
        : null;
  return {
    id: String(row.messageId ?? ''),
    senderId: typeof row.senderId === 'string' && row.senderId.trim() ? row.senderId.trim() : null,
    senderName,
    senderAvatarUrl,
    text: typeof row.text === 'string' ? row.text : '',
    kind: normalizeKind(row.kind),
    imageUrl: typeof row.imageUrl === 'string' && row.imageUrl.trim() ? row.imageUrl.trim() : null,
    imageAlbumBatchId:
      typeof row.imageAlbumBatchId === 'string' && row.imageAlbumBatchId.trim() ? row.imageAlbumBatchId.trim() : null,
    linkPreview: parseLinkPreview(row.linkPreviewJson),
    replyTo: parseReplyTo(row.replyToJson, row.replyToMessageId),
    createdAt: timestampFromMs(row.createdAtMs),
    updatedAt: timestampFromMs(row.updatedAtMs) ?? timestampFromMs(row.createdAtMs),
    deletedAt: timestampFromMs(row.deletedAtMs),
  };
}

function meetingMessageToSocialMessage(m: MeetingChatMessage): SocialChatMessage {
  return {
    id: m.id,
    senderId: m.senderId,
    text: m.text,
    kind: m.kind,
    imageUrl: m.imageUrl,
    imageAlbumBatchId: m.imageAlbumBatchId ?? null,
    linkPreview: m.linkPreview ?? null,
    replyTo: m.replyTo as SocialChatReplyTo | null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt ?? null,
    deletedAt: m.deletedAt ?? null,
  };
}

function useLocalMeetingMessagesByType({
  roomType,
  roomId,
  enabled,
  limit,
}: {
  roomType: 'meeting' | 'social_dm';
  roomId: string;
  enabled: boolean;
  limit?: number;
}) {
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);

  useEffect(() => {
    const db = database;
    const rid = roomId.trim();
    if (!db || !enabled || !rid) {
      setMessages([]);
      return;
    }
    const take = Math.min(Math.max(20, limit ?? DEFAULT_LOCAL_MESSAGE_LIMIT), 5000);
    const query = db
      .get('chat_messages')
      .query(
        Q.where('room_id', rid),
        Q.where('room_type', roomType),
        Q.sortBy('created_at_ms', Q.desc),
        Q.take(take),
      );
    const sub = query.observeWithColumns([...WM_CHAT_MESSAGE_LIST_OBSERVE_COLUMNS]).subscribe((rows: any[]) => {
      setMessages(rows.map(localRowToMeetingMessage).filter((m) => m.id && m.createdAt));
    });
    return () => sub.unsubscribe();
  }, [enabled, limit, roomId, roomType]);

  return messages;
}

export function useLocalMeetingChatMessages({
  meetingId,
  enabled,
  limit,
}: {
  meetingId: string;
  enabled: boolean;
  limit?: number;
}) {
  return useLocalMeetingMessagesByType({ roomType: 'meeting', roomId: meetingId, enabled, limit });
}

export function useLocalSocialChatMessages({
  roomId,
  enabled,
  limit,
}: {
  roomId: string;
  enabled: boolean;
  limit?: number;
}) {
  const newestFirst = useLocalMeetingMessagesByType({ roomType: 'social_dm', roomId, enabled, limit });
  return [...newestFirst].reverse().map(meetingMessageToSocialMessage);
}
