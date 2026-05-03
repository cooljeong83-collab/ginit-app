/**
 * 모임 생성 화면 스크롤/본문 터치 시 에이전트 말풍선을 닫기 위한 경량 구독 (Provider 밖에서 호출 가능).
 */
type Listener = () => void;

const listeners = new Set<Listener>();
/** 사용자가 직접 스크롤할 때 — 말풍선 재표시는 확인 버튼·AI FAB 탭까지 보류(FAB에서 suppress와 함께 처리) */
const manualScrollDismissListeners = new Set<Listener>();
const bubbleShowListeners = new Set<Listener>();

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

export function subscribeCreateMeetingAgentBubbleDismissFromManualScroll(listener: Listener): () => void {
  manualScrollDismissListeners.add(listener);
  return () => {
    manualScrollDismissListeners.delete(listener);
  };
}

export function notifyCreateMeetingAgentBubbleDismissFromManualScroll(): void {
  manualScrollDismissListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeCreateMeetingAgentBubbleShow(listener: Listener): () => void {
  bubbleShowListeners.add(listener);
  return () => {
    bubbleShowListeners.delete(listener);
  };
}

export function notifyCreateMeetingAgentBubbleShow(): void {
  bubbleShowListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}
