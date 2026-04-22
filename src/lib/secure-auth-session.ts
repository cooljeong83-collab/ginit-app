import { compatDeleteItemAsync, compatGetItemAsync, compatSetItemAsync } from '@/src/lib/secure-store-compat';

export type SecureAuthSession = {
  /** Firebase Auth uid */
  uid: string;
  /** 앱 사용자 PK — 신규는 정규화 이메일, 레거시는 전화 E.164(+82…) */
  userId: string;
};

const KEY = 'ginit.secureAuthSession.v1';

type LegacyShape = { uid?: string; phoneUserId?: string; userId?: string };

export async function writeSecureAuthSession(session: SecureAuthSession): Promise<void> {
  const uid = session.uid.trim();
  const userId = session.userId.trim();
  if (!uid || !userId) return;
  await compatSetItemAsync(KEY, JSON.stringify({ uid, userId }));
}

export async function readSecureAuthSession(): Promise<SecureAuthSession | null> {
  try {
    const raw = await compatGetItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LegacyShape;
    if (!parsed.uid) return null;
    const uid = String(parsed.uid).trim();
    const userId = String(parsed.userId ?? parsed.phoneUserId ?? '').trim();
    if (!uid || !userId) return null;
    return { uid, userId };
  } catch {
    return null;
  }
}

export async function clearSecureAuthSession(): Promise<void> {
  try {
    await compatDeleteItemAsync(KEY);
  } catch {
    /* noop */
  }
}
