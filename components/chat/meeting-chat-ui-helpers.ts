import type { Timestamp } from '@/src/lib/ginit-timestamp';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { formatDateTimeWithKoWeekday } from '@/src/lib/date-display';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import type { UserProfile } from '@/src/lib/user-profile';
import { WITHDRAWN_NICKNAME, isUserProfileWithdrawn } from '@/src/lib/user-profile';

/** 말풍선에 캐시된 발신자 메타 → 프로필 RPC 전에도 아바타 깜빡임 완화 */
export function profilesFromMessageSenderMeta(
  messages: ReadonlyArray<{
    senderId?: string | null;
    senderName?: string | null;
    senderAvatarUrl?: string | null;
  }>,
): Map<string, UserProfile> {
  const out = new Map<string, UserProfile>();
  for (const message of messages) {
    const senderId = message.senderId?.trim() ? normalizeParticipantId(message.senderId.trim()) : '';
    if (!senderId) continue;
    const photoUrl = message.senderAvatarUrl?.trim() || null;
    const nickname = message.senderName?.trim() || '회원';
    if (!photoUrl && nickname === '회원') continue;
    const existing = out.get(senderId);
    const existingPhoto = existing?.photoUrl?.trim() || null;
    if (existingPhoto && photoUrl && existingPhoto !== photoUrl) {
      out.set(senderId, {
        nickname: existing?.nickname?.trim() || nickname,
        photoUrl,
      });
      continue;
    }
    if (existingPhoto || (existing && !photoUrl)) continue;
    out.set(senderId, { nickname, photoUrl });
  }
  return out;
}

export function profileForSender(map: Map<string, UserProfile>, senderId: string): UserProfile | undefined {
  const n = normalizeParticipantId(senderId);
  const hit = map.get(senderId) ?? map.get(n);
  if (hit) return hit;
  for (const [k, v] of map) {
    if (normalizeParticipantId(k) === n) return v;
  }
  return undefined;
}

export function formatChatTime(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    return ts.toDate().toLocaleString('ko-KR', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

export function formatImageViewerSentAt(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    return formatDateTimeWithKoWeekday(ts.toDate());
  } catch {
    return '';
  }
}

export function meetingImageViewerMeta(
  item: MeetingChatMessage,
  profiles: Map<string, UserProfile>,
): { senderLabel: string; sentAtLabel: string } {
  const sid = item.senderId?.trim() ? normalizeParticipantId(item.senderId.trim()) : '';
  const prof = sid ? profileForSender(profiles, sid) : undefined;
  const withdrawn = isUserProfileWithdrawn(prof);
  const senderLabel = withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname ?? '회원');
  const sentAtLabel = formatImageViewerSentAt(item.createdAt);
  return { senderLabel, sentAtLabel };
}

export function replyTargetLabel(replyTo: MeetingChatMessage['replyTo'], profiles: Map<string, UserProfile>): string {
  const sid = replyTo?.senderId?.trim() ? normalizeParticipantId(replyTo.senderId.trim()) : '';
  const prof = sid ? profileForSender(profiles, sid) : undefined;
  const withdrawn = isUserProfileWithdrawn(prof);
  const nick = withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname ?? '회원');
  return nick;
}

export function replyPreviewText(replyTo: MeetingChatMessage['replyTo']): string {
  if (!replyTo?.messageId) return '';
  return replyTo.kind === 'image' || Boolean(replyTo.imageUrl?.trim()) ? '사진' : (replyTo.text || '메시지');
}
