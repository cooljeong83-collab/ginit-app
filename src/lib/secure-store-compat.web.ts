/**
 * 웹: `expo-secure-store`는 네이티브 모듈에 의존해 `setItemAsync` 등이 동작하지 않을 수 있음.
 * 세션 힌트는 브라우저 localStorage에만 저장합니다(XSS에 더 취약하므로 토큰·비밀값은 넣지 않음).
 */
export async function compatSetItemAsync(key: string, value: string): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {
    /* private mode / quota */
  }
}

export async function compatGetItemAsync(key: string): Promise<string | null> {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {
    /* noop */
  }
  return null;
}

export async function compatDeleteItemAsync(key: string): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
    /* noop */
  }
}
