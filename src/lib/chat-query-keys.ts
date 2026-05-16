import { normalizeParticipantId } from '@/src/lib/app-user-id';

/**
 * 채팅 목록(방·참가자 요약) 전용 TanStack Query 키 루트.
 * **모임** 캐시 `['meetings', ...]`와 절대 섞지 않는다.
 */
export function chatRoomsListQueryKey(rawUserId: string) {
  return ['chat', 'rooms', normalizeParticipantId(rawUserId)] as const;
}
