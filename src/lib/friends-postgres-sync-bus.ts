/**
 * `friends` 테이블 postgres_changes는 전역 멀티플렉스 Realtime 채널 한 곳에서만 구독합니다.
 * 수신 시 이 버스로 알려 InAppAlarms·친구 화면 등이 각자 `load()`/`reload()`만 수행합니다(별도 채널 없음).
 */

const listeners = new Set<() => void>();

export function emitFriendsPostgresChanged(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* noop */
    }
  }
}

export function subscribeFriendsPostgresChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
