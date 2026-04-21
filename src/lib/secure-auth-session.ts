import * as SecureStore from 'expo-secure-store';

export type SecureAuthSession = {
  /** Firebase Auth uid */
  uid: string;
  /** 앱 내부 전화 PK (정규화, 예: +8210...) */
  phoneUserId: string;
};

const KEY = 'ginit.secureAuthSession.v1';

export async function writeSecureAuthSession(session: SecureAuthSession): Promise<void> {
  const uid = session.uid.trim();
  const phoneUserId = session.phoneUserId.trim();
  if (!uid || !phoneUserId) return;
  await SecureStore.setItemAsync(KEY, JSON.stringify({ uid, phoneUserId }));
}

export async function readSecureAuthSession(): Promise<SecureAuthSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SecureAuthSession>;
    if (!parsed.uid || !parsed.phoneUserId) return null;
    const uid = String(parsed.uid).trim();
    const phoneUserId = String(parsed.phoneUserId).trim();
    if (!uid || !phoneUserId) return null;
    return { uid, phoneUserId };
  } catch {
    return null;
  }
}

export async function clearSecureAuthSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* noop */
  }
}

