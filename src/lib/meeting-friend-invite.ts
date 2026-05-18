import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { supabase } from '@/src/lib/supabase';

export const MEETING_FRIEND_INVITE_MAX_RECIPIENTS = 20;

export type MeetingFriendInviteSkipped = {
  not_friend?: number;
  already_joined?: number;
  self?: number;
  empty?: number;
};

export type MeetingFriendInviteResult =
  | { ok: true; sent: number; skipped?: MeetingFriendInviteSkipped; reason?: string }
  | { ok: false; message: string };

function parseSkipped(raw: unknown): MeetingFriendInviteSkipped | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: MeetingFriendInviteSkipped = {};
  for (const k of ['not_friend', 'already_joined', 'self', 'empty'] as const) {
    const n = o[k];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[k] = Math.trunc(n);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function inviteFriendsToMeeting(params: {
  meetingId: string;
  inviterAppUserId: string;
  inviteeAppUserIds: string[];
}): Promise<MeetingFriendInviteResult> {
  const meetingId = params.meetingId.trim();
  const inviter = normalizeParticipantId(params.inviterAppUserId) ?? params.inviterAppUserId.trim();
  if (!meetingId || !inviter) {
    return { ok: false, message: '모임 또는 사용자 정보가 없습니다.' };
  }

  const seen = new Set<string>();
  const invitees: string[] = [];
  for (const raw of params.inviteeAppUserIds ?? []) {
    const id = normalizeParticipantId(String(raw)) ?? String(raw).trim();
    if (!id || id === inviter || seen.has(id)) continue;
    seen.add(id);
    invitees.push(id);
    if (invitees.length >= MEETING_FRIEND_INVITE_MAX_RECIPIENTS) break;
  }

  if (invitees.length === 0) {
    return { ok: false, message: '초대할 친구를 선택해 주세요.' };
  }

  const { data, error } = await supabase.rpc('meeting_invite_friends', {
    p_meeting_id: meetingId,
    p_inviter_app_user_id: inviter,
    p_invitee_app_user_ids: invitees,
  });

  if (error) {
    return { ok: false, message: error.message?.trim() || '초대에 실패했어요.' };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  if (row.ok === false) {
    const msg = typeof row.message === 'string' ? row.message.trim() : '';
    return { ok: false, message: msg || '초대에 실패했어요.' };
  }

  const sent = typeof row.sent === 'number' && Number.isFinite(row.sent) ? Math.max(0, Math.trunc(row.sent)) : 0;
  const reason = typeof row.reason === 'string' ? row.reason.trim() : undefined;
  return {
    ok: true,
    sent,
    reason: reason || undefined,
    skipped: parseSkipped(row.skipped),
  };
}
