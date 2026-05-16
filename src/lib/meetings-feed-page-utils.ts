import type { Meeting } from '@/src/lib/meetings';
import {
  type MeetingChangeSummary,
  type PublicMeetingsFeedCursor,
  PUBLIC_MEETINGS_PAGE_SIZE,
  publicMeetingsFeedTailCursorFromSummary,
  publicMeetingsFeedTailCursorGuess,
} from '@/src/lib/supabase-meetings-list';

export type MeetingsFeedPageSlice = {
  meetings: Meeting[];
  hasMore: boolean;
  tailCursor?: PublicMeetingsFeedCursor;
};

/**
 * 플랫한 모임 배열을 infinite query `pages` 형태로 자릅니다.
 * `summaryByMeetingId`가 있으면 각 페이지 끝의 `tailCursor`에 DB `rowId`를 넣어 커서 페이징이 유지됩니다.
 */
export function buildMeetingsFeedPagesFromFlatMeetings(
  meetings: readonly Meeting[],
  pageCount: number,
  remoteSummaryCount: number,
  summaryByMeetingId?: ReadonlyMap<string, MeetingChangeSummary>,
): MeetingsFeedPageSlice[] {
  const count = Math.max(1, pageCount);
  return Array.from({ length: count }, (_, idx) => {
    const from = idx * PUBLIC_MEETINGS_PAGE_SIZE;
    const slice = meetings.slice(from, from + PUBLIC_MEETINGS_PAGE_SIZE);
    const last = slice[slice.length - 1] ?? null;
    let tailCursor: PublicMeetingsFeedCursor | undefined;
    if (last) {
      const mid = typeof last.id === 'string' ? last.id.trim() : '';
      tailCursor =
        publicMeetingsFeedTailCursorFromSummary(last, mid ? summaryByMeetingId?.get(mid) : undefined) ??
        publicMeetingsFeedTailCursorGuess(last) ??
        undefined;
    }
    return {
      meetings: [...slice],
      hasMore: remoteSummaryCount > from + slice.length,
      ...(tailCursor ? { tailCursor } : {}),
    };
  }).filter((page, idx) => idx === 0 || page.meetings.length > 0);
}

/**
 * infinite query 캐시용: `pages`와 `pageParams` 길이를 맞춥니다.
 * `pageParams[i]`는 `pages[i]`를 가져올 때 사용한 커서(첫 페이지는 `undefined`).
 */
export function buildMeetingsFeedInfinitePagesAndPageParams(
  meetings: readonly Meeting[],
  pageCount: number,
  remoteSummaryCount: number,
  summaryByMeetingId?: ReadonlyMap<string, MeetingChangeSummary>,
): { pages: MeetingsFeedPageSlice[]; pageParams: (PublicMeetingsFeedCursor | undefined)[] } {
  const pages = buildMeetingsFeedPagesFromFlatMeetings(
    meetings,
    pageCount,
    remoteSummaryCount,
    summaryByMeetingId,
  );
  if (pages.length === 0) return { pages, pageParams: [] };
  const pageParams: (PublicMeetingsFeedCursor | undefined)[] = [undefined];
  for (let i = 1; i < pages.length; i++) {
    pageParams.push(pages[i - 1]?.tailCursor);
  }
  return { pages, pageParams };
}
