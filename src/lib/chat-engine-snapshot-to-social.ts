import { Timestamp } from '@/src/lib/ginit-timestamp';

import type { ChatEngineMessageSnapshot } from '@/src/hooks/useChatEngine';
import { normalizeMeetingChatLinkPreview } from '@/src/lib/chat-link-preview-normalize';
import type { MeetingChatMessageKind } from '@/src/lib/meeting-chat';
import type { SocialChatMessage, SocialChatReplyTo } from '@/src/lib/social-chat-rooms';

function msToTimestamp(ms: number | null | undefined): Timestamp | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  try {
    return Timestamp.fromMillis(Math.floor(ms));
  } catch {
    return null;
  }
}

function parseLinkPreviewJson(raw: string | null) {
  if (!raw?.trim()) return null;
  try {
    return normalizeMeetingChatLinkPreview(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseReplyToJson(raw: string | null, fallbackMessageId: string | null): SocialChatReplyTo | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const messageId =
      typeof o.messageId === 'string' && o.messageId.trim()
        ? o.messageId.trim()
        : fallbackMessageId?.trim() ?? '';
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

function normalizeKind(kind: string | null | undefined): MeetingChatMessageKind | undefined {
  return kind === 'system' ? 'system' : kind === 'image' ? 'image' : kind === 'text' ? 'text' : undefined;
}

/**
 * `useChatEngine` 스냅샷(최신→과거) → 소셜 DM 화면이 기대하는 **시간순(과거→최신)** `SocialChatMessage[]`.
 */
export function chatEngineSnapshotsToSocialMessagesChrono(rows: readonly ChatEngineMessageSnapshot[]): SocialChatMessage[] {
  if (!rows.length) return [];
  const chrono = [...rows].reverse();
  return chrono.map((r) => {
    const createdAt = msToTimestamp(r.createdAtMs);
    const updatedAt = msToTimestamp(r.updatedAtMs) ?? createdAt;
    const deletedAt = msToTimestamp(r.deletedAtMs);
    const kind = normalizeKind(r.kind);
    const replyTo = parseReplyToJson(r.replyToJson, r.replyToMessageId);
    const linkPreview = parseLinkPreviewJson(r.linkPreviewJson);
    return {
      id: r.messageId.trim() || r.watermelonId,
      serverSeq: typeof r.seq === 'number' && Number.isFinite(r.seq) && r.seq > 0 ? Math.floor(r.seq) : undefined,
      clientMutationId: typeof r.clientMutationId === 'string' && r.clientMutationId.trim() ? r.clientMutationId.trim() : null,
      senderId: r.senderId,
      senderName: r.senderName ?? undefined,
      senderAvatarUrl: r.senderAvatarUrl ?? undefined,
      text: typeof r.text === 'string' ? r.text : '',
      kind,
      imageUrl: r.imageUrl,
      imageAlbumBatchId: r.imageAlbumBatchId,
      linkPreview,
      replyTo,
      createdAt,
      updatedAt: updatedAt ?? undefined,
      deletedAt,
    };
  });
}
