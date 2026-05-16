/** TanStack Query — 사용자 프로필(`app_user_id` 기준). */
export function userProfileQueryKey(appUserId: string) {
  return ['user', 'profile', appUserId] as const;
}
