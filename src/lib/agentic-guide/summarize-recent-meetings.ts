import type { Meeting } from '@/src/lib/meetings';

import type { RecentMeetingsSummary } from '@/src/lib/agentic-guide/types';

const GENERIC_MEETING_LABEL = '모임';

export function isUsefulMeetingPatternLabel(raw: string | null | undefined): boolean {
  const t = raw?.trim();
  if (!t) return false;
  if (t === GENERIC_MEETING_LABEL) return false;
  return true;
}

/** 카테고리 라벨 우선, 없으면 제목(패턴 요약용). */
export function patternLabelFromMeeting(m: Meeting): string {
  const l = (m.categoryLabel ?? '').trim();
  if (l) return l;
  return (m.title ?? '').trim() || GENERIC_MEETING_LABEL;
}

function labelOf(m: Meeting): string {
  return patternLabelFromMeeting(m);
}

/**
 * 주어진 모임 목록에서 유의미한 카테고리(라벨) 최빈값 1개.
 */
export function topUsefulPatternInMeetings(
  meetings: Meeting[],
  maxSample = 40,
): { label: string; count: number; sampled: number } | null {
  const slice = meetings.slice(0, maxSample);
  if (slice.length === 0) return null;
  const freq = new Map<string, number>();
  for (const m of slice) {
    const lab = labelOf(m);
    if (!isUsefulMeetingPatternLabel(lab)) continue;
    freq.set(lab, (freq.get(lab) ?? 0) + 1);
  }
  if (freq.size === 0) return null;
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [label, count] = sorted[0]!;
  return { label, count, sampled: slice.length };
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
