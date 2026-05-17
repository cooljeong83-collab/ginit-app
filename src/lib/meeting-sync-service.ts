/**
 * 모임(Meetings) 도메인 전용 동기화.
 * - 오직 `['meetings', 'feed', …]`, `['meetings', 'my-feed', …]` 캐시와 meetings 관련 RPC만 다룬다.
 * - 채팅 방·`['chat', …]` 캐시는 건드리지 않는다 (`chat-sync-service` 참고).
 */
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { Meeting } from '@/src/lib/meetings';
import type { MeetingsFeedPageSlice } from '@/src/lib/meetings-feed-page-utils';
import { meetingsFeedInfiniteQueryKey, myMeetingsFeedQueryKey } from '@/src/lib/meetings-query-keys';
import {
  getMyMeetingsFeedLastSyncIso,
  getPublicMeetingsFeedLastSyncIso,
  setMyMeetingsFeedLastSyncIso,
  setPublicMeetingsFeedLastSyncIso,
} from '@/src/lib/meetings-sync-last-at-storage';
import { removeMeetingsFromMeetingsFeedCaches } from '@/src/lib/meetings-feed-realtime-cache-patch';
import {
  diffMeetingSummariesDelta,
  fetchMeetingsForSyncByIds,
  fetchMeetingChangeSummariesSince,
  fetchMyMeetingChangeSummariesSince,
  maxMeetingUpdatedAtIso,
} from '@/src/lib/supabase-meetings-list';
import type { PublicMeetingsFeedCursor } from '@/src/lib/supabase-meetings-list';

type FeedInfiniteData = InfiniteData<MeetingsFeedPageSlice, PublicMeetingsFeedCursor | undefined>;

export type MeetingsQuerySurgicalSyncScope = 'public' | 'my' | 'both';

export type PerformMeetingsQuerySurgicalSyncOptions = {
  scope: MeetingsQuerySurgicalSyncScope;
  refetchWhenPublicCacheEmpty?: boolean;
};

export type PerformMeetingsQuerySurgicalSyncResult =
  | { status: 'ok'; publicRefetchedEmpty: boolean; patchedAny: boolean }
  | { status: 'failed' }
  | { status: 'skipped' };

function flattenInfiniteMeetings(data: FeedInfiniteData | undefined): Meeting[] {
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

function nextWatermarkIsoFromMeetings(meetings: readonly Meeting[]): string {
  let ms = Date.now();
  for (const m of meetings) {
    try {
      const t = m.updatedAt?.toMillis?.() ?? 0;
      if (Number.isFinite(t) && t > ms) ms = t;
    } catch {
      /* ignore */
    }
  }
  return new Date(ms).toISOString();
}

export function patchMeetingsInInfiniteFeedCache(
  queryClient: QueryClient,
  updates: ReadonlyMap<string, Meeting>,
  prependIfMissing: readonly Meeting[],
): boolean {
  const key = meetingsFeedInfiniteQueryKey();
  let mutated = false;
  queryClient.setQueryData<FeedInfiniteData>(key, (prev) => {
    if (!prev) return prev;
    const idInPages = new Set<string>();
    for (const p of prev.pages) {
      for (const m of p.meetings) {
        const id = typeof m.id === 'string' ? m.id.trim() : '';
        if (id) idInPages.add(id);
      }
    }

    let pages = prev.pages.map((page) => ({
      ...page,
      meetings: page.meetings.map((m) => {
        const id = typeof m.id === 'string' ? m.id.trim() : '';
        const rep = id ? updates.get(id) : undefined;
        if (rep && rep !== m) {
          mutated = true;
          return rep;
        }
        return m;
      }),
    }));

    const prep = prependIfMissing.filter((m) => {
      const id = typeof m.id === 'string' ? m.id.trim() : '';
      return id && !idInPages.has(id);
    });
    if (prep.length > 0 && pages.length > 0) {
      const p0 = pages[0]!;
      pages = [{ ...p0, meetings: [...prep, ...p0.meetings] }, ...pages.slice(1)];
      mutated = true;
    }

    if (!mutated) return prev;
    return { ...prev, pages };
  });
  return mutated;
}

export function patchMeetingsInMyFeedCache(
  queryClient: QueryClient,
  normalizedUserId: string,
  updates: ReadonlyMap<string, Meeting>,
  prependIfMissing: readonly Meeting[],
): boolean {
  const key = myMeetingsFeedQueryKey(normalizedUserId);
  let mutated = false;
  queryClient.setQueryData<{ meetings: Meeting[] }>(key, (prev) => {
    const meetings = prev?.meetings ?? [];
    const existingIds = new Set(meetings.map((m) => (typeof m.id === 'string' ? m.id.trim() : '')).filter(Boolean));

    const next = meetings.map((m) => {
      const id = typeof m.id === 'string' ? m.id.trim() : '';
      const rep = id ? updates.get(id) : undefined;
      if (rep && rep !== m) {
        mutated = true;
        return rep;
      }
      return m;
    });

    const prep = prependIfMissing.filter((m) => {
      const id = typeof m.id === 'string' ? m.id.trim() : '';
      return id && !existingIds.has(id);
    });
    if (prep.length > 0) {
      mutated = true;
      return { meetings: [...prep, ...next] };
    }
    if (!mutated) return prev;
    return { meetings: next };
  });
  return mutated;
}

/** 삭제·권한 상실 등으로 상세 fetch에 없는 id를 피드 캐시에서 제거합니다. */
export function removeMeetingFromMeetingsQueryCaches(
  queryClient: QueryClient,
  meetingId: string,
  viewerUserId?: string | null,
): boolean {
  const mid = meetingId.trim();
  if (!mid) return false;
  const uid = normalizeParticipantId(viewerUserId ?? '');
  return removeMeetingsFromMeetingsFeedCaches(
    queryClient,
    [mid],
    {
      feedKey: meetingsFeedInfiniteQueryKey(),
      myFeedKey: uid ? myMeetingsFeedQueryKey(uid) : null,
    },
  );
}

export async function performMeetingsQuerySurgicalSync(
  queryClient: QueryClient,
  viewerUserId: string | null | undefined,
  options: PerformMeetingsQuerySurgicalSyncOptions,
): Promise<PerformMeetingsQuerySurgicalSyncResult> {
  const scope = options.scope;
  const refetchEmpty = options.refetchWhenPublicCacheEmpty ?? true;
  const pubKey = meetingsFeedInfiniteQueryKey();
  const uid = normalizeParticipantId(viewerUserId ?? '');

  if (scope === 'my' && !uid) {
    return { status: 'skipped' };
  }

  const runPublic = scope === 'public' || scope === 'both';
  const runMy = (scope === 'my' || scope === 'both') && Boolean(uid);

  let publicRefetchedEmpty = false;
  let patchedAny = false;

  const pubKeySpread = [...pubKey] as readonly unknown[];
  let flatPub = flattenInfiniteMeetings(queryClient.getQueryData<FeedInfiniteData>(pubKey));
  let skipPublicDelta = false;

  if (runPublic && flatPub.length === 0) {
    if (refetchEmpty) {
      try {
        await queryClient.refetchQueries({ queryKey: pubKeySpread });
        await setPublicMeetingsFeedLastSyncIso(new Date().toISOString());
        publicRefetchedEmpty = true;
        flatPub = flattenInfiniteMeetings(queryClient.getQueryData<FeedInfiniteData>(pubKey));
        skipPublicDelta = true;
      } catch {
        return { status: 'failed' };
      }
    } else if (!runMy) {
      return { status: 'skipped' };
    }
  }

  const myKey = uid ? myMeetingsFeedQueryKey(uid) : null;
  const flatMy =
    runMy && myKey
      ? (() => {
          const d = queryClient.getQueryData<{ meetings: Meeting[] }>(myKey);
          return d?.meetings ?? [];
        })()
      : [];

  let lastPub: string | null = null;
  if (runPublic && flatPub.length > 0 && !skipPublicDelta) {
    lastPub = (await getPublicMeetingsFeedLastSyncIso()) ?? maxMeetingUpdatedAtIso(flatPub);
  }

  let lastMy: string | null = null;
  if (runMy && flatMy.length > 0) {
    lastMy = (await getMyMeetingsFeedLastSyncIso()) ?? maxMeetingUpdatedAtIso(flatMy);
  }

  const pubDelta =
    runPublic && lastPub
      ? await fetchMeetingChangeSummariesSince(lastPub, 500)
      : { ok: true as const, summaries: [] };
  if (!pubDelta.ok) return { status: 'failed' };

  const myDelta =
    runMy && lastMy
      ? await fetchMyMeetingChangeSummariesSince(uid, lastMy, 500)
      : { ok: true as const, summaries: [] };
  if (!myDelta.ok) return { status: 'failed' };

  const pubChanged = runPublic && lastPub ? diffMeetingSummariesDelta(flatPub, pubDelta.summaries).changedIds : [];
  const myChanged = runMy && lastMy ? diffMeetingSummariesDelta(flatMy, myDelta.summaries).changedIds : [];

  const allChanged = [...new Set([...pubChanged, ...myChanged].map((x) => x.trim()).filter(Boolean))];

  let detail: Meeting[] = [];
  if (allChanged.length > 0) {
    const res = await fetchMeetingsForSyncByIds(allChanged, uid || null);
    if (!res.ok) return { status: 'failed' };
    detail = res.meetings;
  }

  const byId = new Map(
    detail.map((m) => {
      const id = typeof m.id === 'string' ? m.id.trim() : '';
      return [id, m] as const;
    }).filter(([k]) => k.length > 0),
  );

  const prepPub: Meeting[] = [];
  const updPub = new Map<string, Meeting>();
  for (const id of pubChanged) {
    const m = byId.get(id);
    if (!m) continue;
    if (flatPub.some((x) => (typeof x.id === 'string' ? x.id.trim() : '') === id)) updPub.set(id, m);
    else prepPub.push(m);
  }

  const prepMy: Meeting[] = [];
  const updMy = new Map<string, Meeting>();
  for (const id of myChanged) {
    const m = byId.get(id);
    if (!m) continue;
    if (flatMy.some((x) => (typeof x.id === 'string' ? x.id.trim() : '') === id)) updMy.set(id, m);
    else prepMy.push(m);
  }

  const cacheKeys = {
    feedKey: pubKey,
    myFeedKey: myKey,
  };
  const pubRemoveIds = pubChanged
    .map((x) => x.trim())
    .filter(
      (id) =>
        id &&
        !byId.has(id) &&
        flatPub.some((x) => (typeof x.id === 'string' ? x.id.trim() : '') === id),
    );
  const myRemoveIds = myChanged
    .map((x) => x.trim())
    .filter(
      (id) =>
        id &&
        !byId.has(id) &&
        flatMy.some((x) => (typeof x.id === 'string' ? x.id.trim() : '') === id),
    );

  if (runPublic && pubRemoveIds.length > 0) {
    if (removeMeetingsFromMeetingsFeedCaches(queryClient, pubRemoveIds, cacheKeys, { myFeed: false })) {
      patchedAny = true;
    }
  }
  if (runMy && myRemoveIds.length > 0) {
    if (removeMeetingsFromMeetingsFeedCaches(queryClient, myRemoveIds, cacheKeys, { publicFeed: false })) {
      patchedAny = true;
    }
  }

  if (runPublic && (flatPub.length > 0 || prepPub.length > 0 || updPub.size > 0)) {
    if (patchMeetingsInInfiniteFeedCache(queryClient, updPub, prepPub)) patchedAny = true;
  }

  if (runMy && uid && (flatMy.length > 0 || prepMy.length > 0 || updMy.size > 0)) {
    if (patchMeetingsInMyFeedCache(queryClient, uid, updMy, prepMy)) patchedAny = true;
  }

  const isoWatermark =
    detail.length > 0 ? nextWatermarkIsoFromMeetings(detail) : new Date().toISOString();

  if (runPublic && lastPub) {
    await setPublicMeetingsFeedLastSyncIso(isoWatermark);
  }
  if (runMy && lastMy) {
    await setMyMeetingsFeedLastSyncIso(isoWatermark);
  }

  return { status: 'ok', publicRefetchedEmpty, patchedAny };
}

export type MeetingsUserActionDeltaReason = 'pull_refresh' | 'foreground';

export async function runMeetingsUserActionDeltaSync(
  queryClient: QueryClient,
  viewerUserId: string | null | undefined,
  reason: MeetingsUserActionDeltaReason,
): Promise<PerformMeetingsQuerySurgicalSyncResult> {
  return performMeetingsQuerySurgicalSync(queryClient, viewerUserId, {
    scope: 'both',
    refetchWhenPublicCacheEmpty: reason === 'pull_refresh',
  });
}
