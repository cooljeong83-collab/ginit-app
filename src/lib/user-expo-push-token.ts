/** 레거시 Firestore `userExpoPushTokens` 컬렉션명 — 참조용 상수만 유지합니다. */
export const USER_EXPO_PUSH_TOKENS_COLLECTION = 'userExpoPushTokens';

/** 예전 Firestore 저장소 제거 — Expo 토큰은 Supabase/서버 경로로만 관리하세요. */
export async function saveUserExpoPushToken(_phoneUserId: string, _expoPushToken: string): Promise<void> {
  /* no-op */
}
