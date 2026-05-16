/** `user_notifications` 채널(`user_notifications:{profiles.id}`)의 `refresh_list` 브로드캐스트 → DM 목록 RPC 재동기화 등에 공유 구독. */
const listeners = new Set<() => void>();

export function publishChatListRefresh(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* noop */
    }
  }
}

export function subscribeChatListRefresh(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
