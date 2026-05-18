import type { QueryClient } from '@tanstack/react-query';

import { meetingDetailQueryKey } from '@/src/lib/meeting-detail-query-keys';
import { upsertMeetingDetailToWatermelon } from '@/src/lib/meeting-detail-watermelon-cache';
import { removeMeetingFromMeetingsQueryCaches } from '@/src/lib/meeting-feed-query-cache-remove';

/** 서버·RPC에서 모임 문서가 없음을 나타내는 메시지(삭제·만료 등). */
export function isMeetingNotFoundMessage(message: string): boolean {
  const msg = message.trim();
  if (!msg) return false;
  return (
    /모임을?\s*찾을\s*수\s*없/i.test(msg) ||
    /모임\s*정보를?\s*찾을\s*수\s*없/i.test(msg) ||
    /\bnot\s*found\b/i.test(msg)
  );
}

export function isMeetingNotFoundError(error: unknown): boolean {
  if (error instanceof Error) return isMeetingNotFoundMessage(error.message);
  if (typeof error === 'string') return isMeetingNotFoundMessage(error);
  return false;
}

/**
 * 삭제된 모임 — Watermelon 상세·TanStack 상세·피드 목록 캐시에서 제거합니다.
 */
export async function purgeDeletedMeetingLocally(
  queryClient: QueryClient,
  meetingId: string,
  viewerUserId?: string | null,
): Promise<void> {
  const id = meetingId.trim();
  if (!id) return;
  await upsertMeetingDetailToWatermelon(id, null);
  queryClient.setQueryData(meetingDetailQueryKey(id), null);
  removeMeetingFromMeetingsQueryCaches(queryClient, id, viewerUserId);
}
