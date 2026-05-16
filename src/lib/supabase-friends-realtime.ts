import { normalizeParticipantId } from '@/src/lib/app-user-id';

export function friendsRealtimeEqFilter(
  column: 'requester_app_user_id' | 'addressee_app_user_id',
  rawAppUserId: string,
): string {
  const v = normalizeParticipantId(rawAppUserId).replace(/"/g, '\\"');
  return `${column}=eq."${v}"`;
}

/**
 * `public.friends` Realtime은 `subscribeGlobalUserSyncChannel` 멀티플렉스 한 곳에서만 구독합니다.
 * UI 측은 `subscribeFriendsPostgresChanged`로 변경 알림만 받습니다.
 */
