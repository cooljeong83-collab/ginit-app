import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { Meeting } from '@/src/lib/meetings';
import { buildMeetingsFeedInfinitePagesAndPageParams } from '@/src/lib/meetings-feed-page-utils';
import type { MeetingsFeedPageSlice } from '@/src/lib/meetings-feed-page-utils';
import { mapSupabaseMeetingRow, PUBLIC_MEETINGS_PAGE_SIZE } from '@/src/lib/supabase-meetings-list';
import type { PublicMeetingsFeedCursor } from '@/src/lib/supabase-meetings-list';

/** (레거시) Realtime `postgres_changes` 페이로드 — 캐시 패치 유틸이 참조하는 형태 */
export type MeetingsTableRealtimePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRecord: Record<string, unknown> | null;
  oldRecord: Record<string, unknown> | null;
};

export type FeedInfiniteData = InfiniteData<MeetingsFeedPageSlice, PublicMeetingsFeedCursor | undefined>;

function flattenFeedPages(data: FeedInfiniteData | undefined): Meeting[] {
  const pages = data?.pages ?? [];
  const seen = new Set<string>();
  const out: Meeting[] = [];
  for (const p of pages) {
    for (const m of p.meetings) {
      const id = typeof m.id === 'string' ? m.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(m);
    }
  }
  return out;
}

function meetingIdFromRealtimeRow(row: Record<string, unknown>): string {
  const legacy =
    typeof row.legacy_firestore_id === 'string' && row.legacy_firestore_id.trim()
      ? row.legacy_firestore_id.trim()
      : '';
  const rowId = (typeof row.id === 'string' ? row.id : String(row.id ?? '')).trim();
  return legacy || rowId;
}

export type MeetingsFeedCacheKeys = { feedKey: readonly unknown[]; myFeedKey: readonly unknown[] | null };

export type RemoveMeetingsFromFeedCachesScope = {
  publicFeed?: boolean;
  myFeed?: boolean;
};

function meetingIdInRemoveSet(meetingId: string, idSet: ReadonlySet<string>): boolean {
  const id = meetingId.trim();
  return Boolean(id && idSet.has(id));
}

/** 공개 피드·내 모임 TanStack 캐시에서 지정 id를 제거합니다. */
export function removeMeetingsFromMeetingsFeedCaches(
  qc: QueryClient,
  meetingIds: readonly string[],
  keys: MeetingsFeedCacheKeys,
  scope: RemoveMeetingsFromFeedCachesScope = { publicFeed: true, myFeed: true },
): boolean {
  const idSet = new Set(meetingIds.map((x) => x.trim()).filter(Boolean));
  if (idSet.size === 0) return false;

  const touchPublic = scope.publicFeed !== false;
  const touchMy = scope.myFeed !== false && keys.myFeedKey != null;
  let mutated = false;

  if (touchPublic) {
    qc.setQueryData<FeedInfiniteData>(keys.feedKey, (prev) => {
      if (!prev) return prev;
      const flat = flattenFeedPages(prev);
      const nextFlat = flat.filter((m) => !meetingIdInRemoveSet(typeof m.id === 'string' ? m.id : '', idSet));
      if (nextFlat.length === flat.length) return prev;
      mutated = true;
      const { pages, pageParams } = buildMeetingsFeedInfinitePagesAndPageParams(
        nextFlat,
        prev.pages.length,
        Math.max(PUBLIC_MEETINGS_PAGE_SIZE, nextFlat.length),
      );
      return {
        ...prev,
        pages,
        pageParams,
      };
    });
  }

  if (touchMy && keys.myFeedKey) {
    qc.setQueryData<{ meetings: Meeting[] }>(keys.myFeedKey, (prev) => {
      if (!prev) return prev;
      const next = prev.meetings.filter(
        (m) => !meetingIdInRemoveSet(typeof m.id === 'string' ? m.id : '', idSet),
      );
      if (next.length === prev.meetings.length) return prev;
      mutated = true;
      return { meetings: next };
    });
  }

  return mutated;
}

/** Realtime `new`/`old` 행이 있으면 React Query 캐시(AsyncStorage persist 대상)에 즉시 반영합니다. */
export function applyMeetingsTableRealtimePayloadToQueryCaches(
  qc: QueryClient,
  payload: MeetingsTableRealtimePayload,
  keys: MeetingsFeedCacheKeys,
): void {
  if (payload.eventType === 'DELETE' && payload.oldRecord) {
    const id = meetingIdFromRealtimeRow(payload.oldRecord);
    if (!id) return;
    removeMeetingsFromMeetingsFeedCaches(qc, [id], keys);
    return;
  }

  if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') return;
  const nr = payload.newRecord;
  if (!nr) return;

  const mapped = mapSupabaseMeetingRow(nr);
  if (!mapped.id) return;

  const isPublic = mapped.isPublic === true;
  const { feedKey, myFeedKey } = keys;

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
    const { pages, pageParams } = buildMeetingsFeedInfinitePagesAndPageParams(
      flat,
      prev.pages.length,
      Math.max(PUBLIC_MEETINGS_PAGE_SIZE, flat.length),
    );
    return {
      ...prev,
      pages,
      pageParams,
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
