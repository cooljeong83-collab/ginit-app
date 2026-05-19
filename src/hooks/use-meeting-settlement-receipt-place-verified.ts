import { useQuery } from '@tanstack/react-query';

import type { MeetingReviewPlaceContext } from '@/src/lib/meeting-review/meeting-review-place-context';
import type { Meeting } from '@/src/lib/meetings';
import { isSettlementReceiptPlaceVerified } from '@/src/lib/settlement-receipt-place-match';
import { fetchSettlementReceiptAnalysesFromSupabase } from '@/src/lib/settlement-receipt-analysis-storage';

export function meetingSettlementReceiptPlaceVerifiedQueryKey(meetingId: string): readonly [
  'meeting-review',
  'receipt-place-verified',
  string,
] {
  return ['meeting-review', 'receipt-place-verified', meetingId.trim()] as const;
}

export function useMeetingSettlementReceiptPlaceVerified(
  meetingId: string,
  place: MeetingReviewPlaceContext | null,
  meeting: Meeting | null | undefined,
  enabled = true,
) {
  const mid = meetingId.trim();
  return useQuery({
    queryKey: meetingSettlementReceiptPlaceVerifiedQueryKey(mid),
    queryFn: async (): Promise<boolean> => {
      const receipts = await fetchSettlementReceiptAnalysesFromSupabase(mid);
      if (!place) return false;
      return isSettlementReceiptPlaceVerified(receipts, place, meeting ?? null);
    },
    enabled: enabled && Boolean(mid && place),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}
