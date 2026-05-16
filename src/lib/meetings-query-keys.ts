import { normalizeParticipantId } from '@/src/lib/app-user-id';

/** TanStack Query — 공개 모임 무한 스크롤 */
export function meetingsFeedInfiniteQueryKey() {
  return ['meetings', 'feed', 'supabase'] as const;
}

/** TanStack Query — 내 모임 목록 */
export function myMeetingsFeedQueryKey(appUserId: string) {
  return ['meetings', 'my-feed', 'supabase', normalizeParticipantId(appUserId)] as const;
}
