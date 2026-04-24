import { normalizeParticipantId } from '@/src/lib/app-user-id';
import {
  autoExpireStalePublicUnconfirmedMeetingAsHost,
  meetingPrimaryStartMs,
  type Meeting,
} from '@/src/lib/meetings';

/**
 * 목록에 포함된 모임 중, 로그인 사용자가 주관하는 공개·미확정·일시 경과 모임을 삭제합니다.
 * Firestore 규칙상 삭제는 주관자만 가능하므로, 참가자만 있는 기기에서는 no-op입니다.
 */
export async function sweepStalePublicUnconfirmedMeetingsForHost(
  hostPhoneUserId: string,
  meetings: readonly Meeting[],
): Promise<void> {
  const raw = hostPhoneUserId.trim();
  if (!raw) return;
  const nsSelf = normalizeParticipantId(raw) ?? raw;

  for (const m of meetings) {
    const host = m.createdBy?.trim() ? normalizeParticipantId(m.createdBy) ?? m.createdBy.trim() : '';
    if (!host || host !== nsSelf) continue;
    if (m.isPublic !== true) continue;
    if (m.scheduleConfirmed === true) continue;
    const startMs = meetingPrimaryStartMs(m);
    if (startMs == null || Date.now() < startMs) continue;
    try {
      await autoExpireStalePublicUnconfirmedMeetingAsHost(m.id, raw);
    } catch {
      /* 권한·오프라인 등 */
    }
  }
}
