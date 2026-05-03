import type { Meeting } from '@/src/lib/meetings';

import type { RecentMeetingsSummary } from '@/src/lib/agentic-guide/types';

function labelOf(m: Meeting): string {
  const l = (m.categoryLabel ?? '').trim();
  if (l) return l;
  return (m.title ?? '').trim() || '모임';
}

/**
 * 최근 모임에서 카테고리 라벨 빈도·마지막 제목 요약.
 */
export function summarizeRecentMeetings(meetings: Meeting[], maxSample = 25): RecentMeetingsSummary | null {
  const slice = meetings.slice(0, maxSample);
  if (slice.length === 0) return null;

  const freq = new Map<string, number>();
  for (const m of slice) {
    const lab = labelOf(m);
    freq.set(lab, (freq.get(lab) ?? 0) + 1);
  }
  const topCategoryLabels = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);

  const lastTitle = (slice[0]?.title ?? '').trim() || null;

  return {
    topCategoryLabels,
    lastTitle,
    meetingCountSample: slice.length,
  };
}
