import { useCallback, useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';

import {
  GINIT_MEETING_PLACE_REVIEW_SUBMITTED_EVENT,
  hasUserSubmittedMeetingPlaceReview,
  type GinitMeetingPlaceReviewSubmittedPayload,
} from '@/src/lib/meeting-place-review-dismiss';
import type { Meeting } from '@/src/lib/meetings';
import { isMeetingPlaceReviewEligible } from '@/src/lib/meeting-place-review-notice';

/**
 * 후기 작성 안내 배너를 아직 띄울 모임 id 집합(정산 완료·참여 가능·미작성).
 */
export function usePendingMeetingPlaceReviewIds(
  meetings: readonly Meeting[],
  appUserId: string | null | undefined,
  refreshNonce = 0,
): { pendingIds: Set<string>; loading: boolean; refresh: () => void } {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [localNonce, setLocalNonce] = useState(0);

  const refresh = useCallback(() => setLocalNonce((n) => n + 1), []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      GINIT_MEETING_PLACE_REVIEW_SUBMITTED_EVENT,
      (_payload: GinitMeetingPlaceReviewSubmittedPayload) => {
        setLocalNonce((n) => n + 1);
      },
    );
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const uid = appUserId?.trim() ?? '';
    if (!uid) {
      setPendingIds(new Set());
      setLoading(false);
      return;
    }
    const eligible = meetings.filter((m) => isMeetingPlaceReviewEligible(m, uid));
    if (eligible.length === 0) {
      setPendingIds(new Set());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const rows = await Promise.all(
        eligible.map(async (m) => {
          const id = m.id.trim();
          const submitted = await hasUserSubmittedMeetingPlaceReview(id, uid);
          return { id, pending: !submitted };
        }),
      );
      if (cancelled) return;
      setPendingIds(new Set(rows.filter((r) => r.pending).map((r) => r.id)));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [meetings, appUserId, refreshNonce, localNonce]);

  return { pendingIds, loading, refresh };
}
