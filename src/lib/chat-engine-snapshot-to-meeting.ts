import { Timestamp } from '@/src/lib/ginit-timestamp';

import type { ChatEngineMessageSnapshot } from '@/src/hooks/useChatEngine';
import type { MeetingChatLinkPreview, MeetingChatMessage, MeetingChatMessageKind } from '@/src/lib/meeting-chat';

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

function parseReplyToJson(raw: string | null): MeetingChatMessage['replyTo'] {
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
    return null;
  }
}

function normalizeKind(kind: string | null | undefined): MeetingChatMessageKind {
  return kind === 'system' ? 'system' : kind === 'image' ? 'image' : 'text';
}

/**
 * `useChatEngine` 스냅샷(최신→과거, `created_at_ms` 내림차순) → 모임 채팅 UI `MeetingChatMessage[]` (동일 순서).
 */
export function chatEngineSnapshotsToMeetingMessagesNewestFirst(
  rows: readonly ChatEngineMessageSnapshot[],
): MeetingChatMessage[] {
  return rows.map((r) => {
    const createdAt = msToTimestamp(r.createdAtMs);
    const updatedAt = msToTimestamp(r.updatedAtMs) ?? createdAt ?? undefined;
    const deletedAt = msToTimestamp(r.deletedAtMs);
    const kind = normalizeKind(r.kind);
    const replyTo = parseReplyToJson(r.replyToJson) ?? (r.replyToMessageId ? { messageId: r.replyToMessageId, senderId: null, text: '' } : null);
    const linkPreview = parseLinkPreviewJson(r.linkPreviewJson);
    return {
      id: (r.messageId ?? '').trim() || r.watermelonId,
      serverSeq: typeof r.seq === 'number' && Number.isFinite(r.seq) && r.seq > 0 ? Math.floor(r.seq) : undefined,
      clientMutationId: typeof r.clientMutationId === 'string' && r.clientMutationId.trim() ? r.clientMutationId.trim() : null,
      senderId: r.senderId,
      senderName: r.senderName ?? undefined,
      senderAvatarUrl: r.senderAvatarUrl ?? undefined,
      text: typeof r.text === 'string' ? r.text : '',
      kind,
      imageUrl: r.imageUrl ?? null,
      imageAlbumBatchId: r.imageAlbumBatchId ?? undefined,
      linkPreview,
      replyTo,
      createdAt,
      updatedAt,
      deletedAt,
    };
  });
}
