/**
 * 모임 생성 화면 스크롤/본문 터치 시 에이전트 말풍선을 닫기 위한 경량 구독 (Provider 밖에서 호출 가능).
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeCreateMeetingAgentBubbleDismiss(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyCreateMeetingAgentBubbleDismiss(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}
