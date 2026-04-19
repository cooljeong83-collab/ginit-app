import type { Category } from '@/src/lib/categories';
import type { Meeting } from '@/src/lib/meetings';
import { meetingDistanceMetersFromUser, type LatLng } from '@/src/lib/geo-distance';
import { parseScheduleToTimestamp } from '@/src/lib/meetings';

export type MeetingListSortMode = 'distance' | 'latest' | 'soon';

export type FeedChip = { filterId: string | null; label: string };

export function meetingCreatedAtMs(m: Meeting): number {
  const t = m.createdAt;
  if (t && typeof (t as { toMillis?: () => number }).toMillis === 'function') {
    return (t as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export function meetingScheduleStartMs(m: Meeting): number | null {
  const sa = m.scheduledAt;
  if (sa && typeof (sa as { toMillis?: () => number }).toMillis === 'function') {
    return (sa as { toMillis: () => number }).toMillis();
  }
  const d = m.scheduleDate?.trim() ?? '';
  const t = m.scheduleTime?.trim() ?? '';
  if (!d || !t) return null;
  const ts = parseScheduleToTimestamp(d, t);
  return ts ? ts.toMillis() : null;
}

export function meetingMatchesCategoryFilter(
  m: Meeting,
  filterId: string | null,
  categories: Category[],
): boolean {
  if (filterId == null) return true;
  const selected = categories.find((c) => c.id === filterId);
  const selectedLabel = selected?.label?.trim() ?? '';
  const mid = m.categoryId?.trim();
  if (mid && mid === filterId) return true;
  const ml = (m.categoryLabel ?? '').trim();
  if (ml && selectedLabel && ml === selectedLabel) return true;
  return false;
}

export function listSortModeLabel(mode: MeetingListSortMode): string {
  switch (mode) {
    case 'distance':
      return '거리순';
    case 'soon':
      return '임박순';
    default:
      return '등록순';
  }
}

export function buildFeedChips(meetings: Meeting[], categories: Category[]): FeedChip[] {
  const countByCategoryId = new Map<string, number>();
  for (const m of meetings) {
    const cid = m.categoryId?.trim();
    if (cid) {
      countByCategoryId.set(cid, (countByCategoryId.get(cid) ?? 0) + 1);
      continue;
    }
    const lab = m.categoryLabel?.trim();
    if (!lab) continue;
    const matched = categories.find((c) => c.label.trim() === lab);
    if (matched) {
      countByCategoryId.set(matched.id, (countByCategoryId.get(matched.id) ?? 0) + 1);
    }
  }

  const sorted = [...categories].sort((a, b) => {
    const na = countByCategoryId.get(a.id) ?? 0;
    const nb = countByCategoryId.get(b.id) ?? 0;
    if (nb !== na) return nb - na;
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label, 'ko');
  });

  return [{ filterId: null, label: '전체' }, ...sorted.map((c) => ({ filterId: c.id, label: c.label }))];
}

export function sortMeetingsForFeed(
  filtered: Meeting[],
  listSortMode: MeetingListSortMode,
  userCoords: LatLng | null,
): Meeting[] {
  const list = [...filtered];
  if (listSortMode === 'latest') {
    list.sort((a, b) => {
      const tb = meetingCreatedAtMs(b);
      const ta = meetingCreatedAtMs(a);
      if (tb !== ta) return tb - ta;
      return a.title.localeCompare(b.title, 'ko');
    });
    return list;
  }
  if (listSortMode === 'soon') {
    list.sort((a, b) => {
      const ta = meetingScheduleStartMs(a);
      const tb = meetingScheduleStartMs(b);
      const ia = ta ?? Number.POSITIVE_INFINITY;
      const ib = tb ?? Number.POSITIVE_INFINITY;
      if (ia !== ib) return ia - ib;
      return a.title.localeCompare(b.title, 'ko');
    });
    return list;
  }
  list.sort((a, b) => {
    const da = meetingDistanceMetersFromUser(a, userCoords);
    const db = meetingDistanceMetersFromUser(b, userCoords);
    const sa = da ?? Number.POSITIVE_INFINITY;
    const sb = db ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return a.title.localeCompare(b.title, 'ko');
  });
  return list;
}
