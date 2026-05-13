import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { Meeting } from '@/src/lib/meetings';
import {
  mapSupabaseMeetingRow,
  PUBLIC_MEETINGS_PAGE_SIZE,
  type MeetingsTableRealtimePayload,
} from '@/src/lib/supabase-meetings-list';

export type MeetingsFeedPage = { meetings: Meeting[]; hasMore: boolean };
export type FeedInfiniteData = InfiniteData<MeetingsFeedPage, number>;

function flattenFeedPages(data: FeedInfiniteData | undefined): Meeting[] {
  const pages = data?.pages ?? [];
  const seen = new Set<string>();
  const out: Meeting[] = [];
  for (const p of pages) {
    for (const m of p.meetings) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

function buildPagesFromMeetings(
  meetings: readonly Meeting[],
  pageCount: number,
  remoteSummaryCount: number,
): MeetingsFeedPage[] {
  const count = Math.max(1, pageCount);
  return Array.from({ length: count }, (_, idx) => {
    const from = idx * PUBLIC_MEETINGS_PAGE_SIZE;
    const slice = meetings.slice(from, from + PUBLIC_MEETINGS_PAGE_SIZE);
    return {
      meetings: slice,
      hasMore: remoteSummaryCount > from + slice.length,
    };
  }).filter((page, idx) => idx === 0 || page.meetings.length > 0);
}

function meetingIdFromRealtimeRow(row: Record<string, unknown>): string {
  const legacy =
    typeof row.legacy_firestore_id === 'string' && row.legacy_firestore_id.trim()
      ? row.legacy_firestore_id.trim()
      : '';
  const rowId = (typeof row.id === 'string' ? row.id : String(row.id ?? '')).trim();
  return legacy || rowId;
}

type QueryKeys = { feedKey: readonly unknown[]; myFeedKey: readonly unknown[] | null };

/** Realtime `new`/`old` 행이 있으면 React Query 캐시(AsyncStorage persist 대상)에 즉시 반영합니다. */
export function applyMeetingsTableRealtimePayloadToQueryCaches(
  qc: QueryClient,
  payload: MeetingsTableRealtimePayload,
  keys: QueryKeys,
): void {
  const { feedKey, myFeedKey } = keys;

  if (payload.eventType === 'DELETE' && payload.oldRecord) {
    const id = meetingIdFromRealtimeRow(payload.oldRecord);
    if (!id) return;
    qc.setQueryData<FeedInfiniteData>(feedKey, (prev) => {
      if (!prev) return prev;
      const flat = flattenFeedPages(prev).filter((m) => m.id !== id);
      return {
        ...prev,
        pages: buildPagesFromMeetings(flat, prev.pages.length, Math.max(PUBLIC_MEETINGS_PAGE_SIZE, flat.length)),
      };
    });
    if (myFeedKey) {
      qc.setQueryData<{ meetings: Meeting[] }>(myFeedKey, (prev) => {
        if (!prev) return prev;
        return { meetings: prev.meetings.filter((m) => m.id !== id) };
      });
    }
    return;
  }

  if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') return;
  const nr = payload.newRecord;
  if (!nr) return;

  const mapped = mapSupabaseMeetingRow(nr);
  if (!mapped.id) return;

  const isPublic = mapped.isPublic === true;

  qc.setQueryData<FeedInfiniteData>(feedKey, (prev) => {
    if (!prev) return prev;
    let flat = flattenFeedPages(prev);
    if (!isPublic) {
      flat = flat.filter((m) => m.id !== mapped.id);
    } else {
      const idx = flat.findIndex((m) => m.id === mapped.id);
      if (idx >= 0) {
        const next = [...flat];
        next[idx] = mapped;
        flat = next;
      } else {
        flat = [mapped, ...flat.filter((m) => m.id !== mapped.id)];
      }
    }
    return {
      ...prev,
      pages: buildPagesFromMeetings(flat, prev.pages.length, Math.max(PUBLIC_MEETINGS_PAGE_SIZE, flat.length)),
    };
  });

  if (myFeedKey) {
    qc.setQueryData<{ meetings: Meeting[] }>(myFeedKey, (prev) => {
      if (!prev) return prev;
      const idx = prev.meetings.findIndex((m) => m.id === mapped.id);
      if (idx < 0) return prev;
      const next = [...prev.meetings];
      next[idx] = mapped;
      return { meetings: next };
    });
  }
}
