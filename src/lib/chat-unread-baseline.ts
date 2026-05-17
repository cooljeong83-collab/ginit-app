/**
 * 탭 채팅 배지: 부트 직후 로컬 Watermelon만으로 합산했다가 서버 RPC로 0이 덮이며 깜빡이는 레이스 방지.
 * 세션당 최초 `syncServerParticipantUnreadToLocalWatermelon` 완료 후에만 배지 합계를 노출합니다.
 */

type Listener = () => void;

let baselineReady = false;
const listeners = new Set<Listener>();

export function resetChatUnreadBaseline(): void {
  baselineReady = false;
}

export function markChatUnreadBaselineReady(): void {
  if (baselineReady) return;
  baselineReady = true;
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* noop */
    }
  }
}

export function isChatUnreadBaselineReady(): boolean {
  return baselineReady;
}

export function subscribeChatUnreadBaseline(listener: Listener): () => void {
  listeners.add(listener);
  if (baselineReady) listener();
  return () => {
    listeners.delete(listener);
  };
}
