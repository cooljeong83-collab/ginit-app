import * as SecureStore from 'expo-secure-store';

/**
 * Google/Firebase(JS SDK) 세션 보조 저장소.
 *
 * - Firebase Auth 자체가 AsyncStorage persistence로 세션을 유지하지만,
 *   "최근 로그인 사용자" 같은 힌트를 안전하게 남기고(디버그/부트 최적화),
 *   로그아웃 시 확실히 정리하기 위해 SecureStore를 사용합니다.
 * - 토큰(idToken)은 만료/갱신이 있으므로, 실제 인증 상태는 항상 Firebase auth state로 판단합니다.
 */
export type SecureGoogleSession = {
  uid: string;
  email?: string | null;
};

const KEY = 'ginit.secureGoogleSession.v1';

export async function writeSecureGoogleSession(session: SecureGoogleSession): Promise<void> {
  const uid = session.uid.trim();
  if (!uid) return;
  const email = session.email?.trim() || null;
  await SecureStore.setItemAsync(KEY, JSON.stringify({ uid, email }));
}

export async function readSecureGoogleSession(): Promise<SecureGoogleSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SecureGoogleSession>;
    const uid = String(parsed.uid ?? '').trim();
    if (!uid) return null;
    const email = parsed.email == null ? null : String(parsed.email).trim() || null;
    return { uid, email };
  } catch {
    return null;
  }
}

export async function clearSecureGoogleSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* noop */
  }
}

