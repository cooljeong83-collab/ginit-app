import { compatDeleteItemAsync, compatGetItemAsync, compatSetItemAsync } from '@/src/lib/secure-store-compat';

/**
 * Google 로그인 보조 저장소(최근 사용자 힌트).
 * 실제 인증 상태는 Supabase Auth 세션으로 판단합니다.
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
  await compatSetItemAsync(KEY, JSON.stringify({ uid, email }));
}

export async function readSecureGoogleSession(): Promise<SecureGoogleSession | null> {
  try {
    const raw = await compatGetItemAsync(KEY);
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
    await compatDeleteItemAsync(KEY);
  } catch {
    /* noop */
  }
}

