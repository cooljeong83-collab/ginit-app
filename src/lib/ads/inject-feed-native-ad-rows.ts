import { FEED_NATIVE_AD_INTERVAL } from '@/src/constants/adsConfig';
import type { HomeFeedRow } from '@/src/lib/feed-home-list-rows';

/**
 * 탐색 피드: `MEETING_CARD`만 카운트해 네이티브 광고 행 삽입.
 * `interval`(기본 5) → 목록 5·10·15…번째 칸이 광고(모임 4개마다 1광고).
 * `REVIEW_SECTION`은 카운트·위치에 영향 없음.
 */
export function injectFeedNativeAdRows(
  rows: readonly HomeFeedRow[],
  interval = FEED_NATIVE_AD_INTERVAL,
): HomeFeedRow[] {
  if (interval < 2) return [...rows];
  const meetingsPerAdBlock = interval - 1;
  const out: HomeFeedRow[] = [];
  let meetingCount = 0;
  let adIndex = 0;

  for (const row of rows) {
    if (row.type === 'MEETING_CARD') {
      out.push(row);
      meetingCount += 1;
      if (meetingCount > 0 && meetingCount % meetingsPerAdBlock === 0) {
        out.push({
          type: 'NATIVE_AD',
          adKey: `ad-${adIndex}`,
        });
        adIndex += 1;
      }
      continue;
    }
    out.push(row);
  }

  return out;
}
