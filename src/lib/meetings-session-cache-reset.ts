import type { QueryClient } from '@tanstack/react-query';

import {
  clearMyMeetingsFeedLastSyncIso,
  clearPublicMeetingsFeedLastSyncIso,
} from '@/src/lib/meetings-sync-last-at-storage';

/** 로그아웃·세션 만료 시 이전 계정의 persist·증분 워터마크가 재로그인 후 fetch를 꼬이게 하지 않도록 비웁니다. */
export async function resetMeetingsSessionCaches(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: ['meetings'] });
  queryClient.removeQueries({ queryKey: ['meetings'] });
  await Promise.all([clearPublicMeetingsFeedLastSyncIso(), clearMyMeetingsFeedLastSyncIso()]);
}
