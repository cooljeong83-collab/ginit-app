/** TanStack Query — 모임 상세 단건 */
export function meetingDetailQueryKey(meetingId: string) {
  return ['meeting', meetingId] as const;
}
