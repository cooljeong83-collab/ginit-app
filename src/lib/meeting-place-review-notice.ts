import { Platform } from 'react-native';

import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import { isMeetingHost } from '@/src/lib/settlement-eligibility';
import type { Meeting } from '@/src/lib/meetings';
import { ledgerWritesToSupabase } from '@/src/lib/hybrid-data-source';
import { isLedgerMeetingId } from '@/src/lib/meetings-ledger';

/** 정산 완료 모임에서 후기 배너·하단 CTA 노출 여부 */
export function isMeetingPlaceReviewEligible(
  meeting: Meeting | null | undefined,
  appUserId: string | null | undefined,
): boolean {
  if (Platform.OS === 'web') return false;
  const uid = appUserId?.trim() ?? '';
  if (!meeting?.id?.trim() || !uid) return false;
  if (meeting.lifecycleStatus !== 'SETTLED') return false;
  if (!ledgerWritesToSupabase() || !isLedgerMeetingId(meeting.id)) return false;
  if (isMeetingHost(meeting, uid)) return true;
  return isUserJoinedMeeting(meeting, uid);
}

export function canNavigateToMeetingPlaceReview(meetingId: string | null | undefined): boolean {
  const mid = meetingId?.trim() ?? '';
  if (!mid) return false;
  if (Platform.OS === 'web') return false;
  return ledgerWritesToSupabase() && isLedgerMeetingId(mid);
}
