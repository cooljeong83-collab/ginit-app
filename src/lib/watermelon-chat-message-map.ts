import { Timestamp } from '@/src/lib/ginit-timestamp';

import type { MeetingChatLinkPreview, MeetingChatMessage, MeetingChatMessageKind } from '@/src/lib/meeting-chat';
import type { ChatMessage } from '@/src/watermelon/models/ChatMessage';

function msToTimestamp(ms: number | null | undefined): Timestamp | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  try {
    return Timestamp.fromMillis(Math.floor(ms));
  } catch {
    return null;
  }
}

function parseLinkPreviewJson(raw: string | null): MeetingChatLinkPreview | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    if (!url) return null;
    return {
      url,
      title: typeof o.title === 'string' ? o.title : null,
      description: typeof o.description === 'string' ? o.description : null,
      imageUrl: typeof o.imageUrl === 'string' ? o.imageUrl : null,
      siteName: typeof o.siteName === 'string' ? o.siteName : null,
    };
  } catch {
    return null;
  }
}

function parseReplyToJson(raw: string | null, fallbackMessageId: string | null): MeetingChatMessage['replyTo'] {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const messageId = typeof o.messageId === 'string' ? o.messageId.trim() : '';
    if (!messageId) return null;
    const kindRaw = o.kind;
    const kind: MeetingChatMessageKind | undefined =
      kindRaw === 'system' ? 'system' : kindRaw === 'image' ? 'image' : kindRaw === 'text' ? 'text' : undefined;
    return {
      messageId,
      senderId: typeof o.senderId === 'string' ? o.senderId : o.senderId == null ? null : String(o.senderId),
      kind,
      imageUrl: typeof o.imageUrl === 'string' ? o.imageUrl : o.imageUrl == null ? null : String(o.imageUrl ?? ''),
      text: typeof o.text === 'string' ? o.text : '',
    };
  } catch {
    return fallbackMessageId
      ? { messageId: fallbackMessageId, senderId: null, text: '', kind: undefined, imageUrl: null }
      : null;
  }
}

function normalizeKind(kind: string | null | undefined): MeetingChatMessageKind {
  return kind === 'system' ? 'system' : kind === 'image' ? 'image' : 'text';
}

/** Watermelon `ChatMessage` → UI용 `MeetingChatMessage` */
export function wmChatMessageModelToMeetingMessage(m: ChatMessage): MeetingChatMessage {
  const createdAt = msToTimestamp(m.createdAtMs);
  const updatedAt = msToTimestamp(m.updatedAtMs ?? undefined) ?? createdAt ?? undefined;
  const deletedAt = msToTimestamp(m.deletedAtMs ?? undefined);
  const kind = normalizeKind(m.kind);
  const replyTo =
    parseReplyToJson(m.replyToJson, m.replyToMessageId) ??
    (m.replyToMessageId ? { messageId: m.replyToMessageId, senderId: null, text: '' } : null);
  const linkPreview = parseLinkPreviewJson(m.linkPreviewJson);
  const mid = (m.messageId ?? '').trim();
  return {
    id: mid || String(m.id),
    serverSeq: typeof m.serverSeq === 'number' && Number.isFinite(m.serverSeq) && m.serverSeq > 0 ? Math.floor(m.serverSeq) : undefined,
    clientMutationId: typeof m.clientMutationId === 'string' && m.clientMutationId.trim() ? m.clientMutationId.trim() : null,
    senderId: m.senderId,
    senderName: m.senderName ?? undefined,
    senderAvatarUrl: m.senderAvatarUrl ?? undefined,
    text: typeof m.text === 'string' ? m.text : '',
    kind,
    imageUrl: m.imageUrl ?? null,
    imageAlbumBatchId: m.imageAlbumBatchId ?? undefined,
    linkPreview,
    replyTo,
    createdAt,
    updatedAt,
    deletedAt,
  };
}
