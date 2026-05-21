import type { FeedMeetingReviewCarouselItem } from '@/src/lib/feed-meeting-reviews-api';
import type { Meeting } from '@/src/lib/meetings';

export type HomeFeedRow =
  | { type: 'MEETING_CARD'; meeting: Meeting }
  | { type: 'REVIEW_SECTION'; reviews: FeedMeetingReviewCarouselItem[] }
  | { type: 'NATIVE_AD'; adKey: string };

export const HOME_FEED_REVIEW_SECTION_ROW_KEY = 'feed-review-section';

/**
 * 탐색 피드 세로 목록 — 3번째 슬롯(인덱스 2)에 후기 캐러셀 삽입.
 * 후기가 없으면 섹션 행 자체를 넣지 않습니다.
 */
export function buildExploreFeedRows(
  meetings: readonly Meeting[],
  reviews: readonly FeedMeetingReviewCarouselItem[],
  insertIndex = 2,
): HomeFeedRow[] {
  const rows: HomeFeedRow[] = meetings.map((meeting) => ({ type: 'MEETING_CARD', meeting }));
  if (reviews.length === 0) return rows;

  const section: HomeFeedRow = { type: 'REVIEW_SECTION', reviews: [...reviews] };
  const at = Math.min(Math.max(0, insertIndex), rows.length);
  rows.splice(at, 0, section);
  return rows;
}

export function homeFeedRowKey(row: HomeFeedRow): string {
  if (row.type === 'MEETING_CARD') return row.meeting.id;
  if (row.type === 'NATIVE_AD') return row.adKey;
  return HOME_FEED_REVIEW_SECTION_ROW_KEY;
}
