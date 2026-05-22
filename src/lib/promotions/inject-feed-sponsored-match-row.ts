import type { FeedSponsoredPlace } from '@/src/lib/promotions/place-promotion-types';
import type { HomeFeedRow } from '@/src/lib/feed-home-list-rows';

/**
 * 탐색 피드: `MEETING_CARD`만 카운트해 제휴 매치 카드를 삽입.
 * `REVIEW_SECTION`·`NATIVE_AD`는 카운트·위치에 영향 없음.
 */
export function injectFeedSponsoredMatchRow(
  rows: readonly HomeFeedRow[],
  promotion: FeedSponsoredPlace | null | undefined,
  afterMeetingCount = 5,
): HomeFeedRow[] {
  if (!promotion?.placeKey?.trim() || afterMeetingCount < 1) return [...rows];

  const out: HomeFeedRow[] = [];
  let meetingCount = 0;
  let inserted = false;

  for (const row of rows) {
    if (row.type === 'MEETING_CARD') {
      meetingCount += 1;
      out.push(row);
      if (!inserted && meetingCount === afterMeetingCount) {
        out.push({
          type: 'SPONSORED_MATCH',
          promotion,
          rowKey: `sponsored-match:${promotion.promotionId}`,
        });
        inserted = true;
      }
      continue;
    }
    out.push(row);
  }

  return out;
}
