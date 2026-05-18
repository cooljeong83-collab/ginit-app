import type { QueryClient } from '@tanstack/react-query';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { removeMeetingsFromMeetingsFeedCaches } from '@/src/lib/meetings-feed-realtime-cache-patch';
import { meetingsFeedInfiniteQueryKey, myMeetingsFeedQueryKey } from '@/src/lib/meetings-query-keys';

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
