import type { InfiniteData } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { filterJoinedMeetings } from '@/src/lib/joined-meetings';
import { collectUserConfirmedScheduleTimesByYmd } from '@/src/lib/meeting-schedule-overlap';
import type { Meeting } from '@/src/lib/meetings';
import {
  flattenMeetingsFeedInfiniteData,
  type MeetingsFeedPageSlice,
} from '@/src/lib/meetings-feed-page-utils';
import { meetingsFeedInfiniteQueryKey, myMeetingsFeedQueryKey } from '@/src/lib/meetings-query-keys';

type MyMeetingsQueryData = { meetings: Meeting[] };

const EMPTY_CONFIRMED_SCHEDULE_TIMES_BY_YMD: Readonly<Record<string, readonly string[]>> = {};

export type UserConfirmedScheduleCalendarMarks = {
  readonly ymdSet: ReadonlySet<string>;
  readonly timesByYmd: Readonly<Record<string, readonly string[]>>;
};

const EMPTY_CONFIRMED_SCHEDULE_YMD_SET: ReadonlySet<string> = new Set();

const EMPTY_CALENDAR_MARKS: UserConfirmedScheduleCalendarMarks = {
  ymdSet: EMPTY_CONFIRMED_SCHEDULE_YMD_SET,
  timesByYmd: EMPTY_CONFIRMED_SCHEDULE_TIMES_BY_YMD,
};

function confirmedScheduleCalendarSignature(
  timesByYmd: Readonly<Record<string, readonly string[]>>,
): string {
  const keys = Object.keys(timesByYmd).sort();
  if (keys.length === 0) return '';
  return keys
    .map((ymd) => `${ymd}\u0000${[...timesByYmd[ymd]!].sort().join(',')}`)
    .join('\u0001');
}

function mergeMeetingsById(primary: readonly Meeting[], secondary: readonly Meeting[]): Meeting[] {
  const seen = new Set<string>();
  const out: Meeting[] = [];
  for (const m of [...primary, ...secondary]) {
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(m);
  }
  return out;
}

function readConfirmedScheduleTimesByYmdFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
  uid: string,
  myKey: ReturnType<typeof myMeetingsFeedQueryKey>,
  feedKey: ReturnType<typeof meetingsFeedInfiniteQueryKey>,
  excludeMeetingId?: string | null,
): Readonly<Record<string, readonly string[]>> {
  const myMeetings = queryClient.getQueryData<MyMeetingsQueryData>(myKey)?.meetings ?? [];
  const feedMeetings = flattenMeetingsFeedInfiniteData(
    queryClient.getQueryData<InfiniteData<MeetingsFeedPageSlice>>(feedKey),
  );
  const merged = mergeMeetingsById(myMeetings, feedMeetings);
  const joined = filterJoinedMeetings(merged, uid);
  return collectUserConfirmedScheduleTimesByYmd(joined, uid, excludeMeetingId);
}

function toCalendarMarks(
  timesByYmd: Readonly<Record<string, readonly string[]>>,
): UserConfirmedScheduleCalendarMarks {
  const keys = Object.keys(timesByYmd);
  if (keys.length === 0) return EMPTY_CALENDAR_MARKS;
  return {
    ymdSet: new Set(keys),
    timesByYmd,
  };
}

/**
 * TanStack Query 로컬 캐시(my-feed + 공개 feed infinite)만 구독해
 * 확정된 나의 약속 날짜·시간을 반환합니다. 네트워크 fetch 없음.
 */
export function useUserConfirmedScheduleCalendarMarks(
  userId: string | null | undefined,
  excludeMeetingId?: string | null,
): UserConfirmedScheduleCalendarMarks {
  const queryClient = useQueryClient();
  const uid = useMemo(() => normalizeParticipantId(userId ?? ''), [userId]);
  const excludeId = useMemo(() => excludeMeetingId?.trim() ?? '', [excludeMeetingId]);
  const myKey = useMemo(() => (uid ? myMeetingsFeedQueryKey(uid) : null), [uid]);
  const feedKey = meetingsFeedInfiniteQueryKey();
  const stableRef = useRef<{ signature: string; value: UserConfirmedScheduleCalendarMarks }>({
    signature: '',
    value: EMPTY_CALENDAR_MARKS,
  });
  const [marks, setMarks] = useState<UserConfirmedScheduleCalendarMarks>(EMPTY_CALENDAR_MARKS);

  const syncFromCache = useCallback(() => {
    if (!uid || !myKey) {
      if (stableRef.current.value === EMPTY_CALENDAR_MARKS) return;
      stableRef.current = { signature: '', value: EMPTY_CALENDAR_MARKS };
      setMarks(EMPTY_CALENDAR_MARKS);
      return;
    }

    const timesByYmd = readConfirmedScheduleTimesByYmdFromCache(
      queryClient,
      uid,
      myKey,
      feedKey,
      excludeId || null,
    );
    const signature = confirmedScheduleCalendarSignature(timesByYmd);
    if (stableRef.current.signature === signature) return;

    const value = toCalendarMarks(timesByYmd);
    stableRef.current = { signature, value };
    setMarks(value);
  }, [queryClient, uid, myKey, feedKey, excludeId]);

  useEffect(() => {
    syncFromCache();
    return queryClient.getQueryCache().subscribe(syncFromCache);
  }, [queryClient, syncFromCache]);

  return marks;
}

/** @deprecated `useUserConfirmedScheduleCalendarMarks` 사용 */
export function useUserConfirmedScheduleYmdSet(userId: string | null | undefined): ReadonlySet<string> {
  return useUserConfirmedScheduleCalendarMarks(userId).ymdSet;
}
