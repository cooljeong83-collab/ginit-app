import { useEffect, useRef } from 'react';

/** 이전 Realtime 채널 teardown 후 재구독까지 대기(ms) */
export const REALTIME_FOCUS_RESUBSCRIBE_DELAY_MS = 150;

/**
 * 화면 포커스 시에만 구독을 시작하고, 블러 시 즉시 teardown.
 * 포커스 직후에는 `delayMs`만큼 기다린 뒤 새 채널을 만든다.
 */
export function useFocusedDelayedSubscription(
  isFocused: boolean,
  subscribe: () => void | (() => void),
  deps: readonly unknown[],
  delayMs: number = REALTIME_FOCUS_RESUBSCRIBE_DELAY_MS,
): void {
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  useEffect(() => {
    if (!isFocused) return;

    let alive = true;
    let teardown: void | (() => void);

    const timer = setTimeout(() => {
      if (!alive) return;
      teardown = subscribeRef.current();
    }, delayMs);

    return () => {
      alive = false;
      clearTimeout(timer);
      if (typeof teardown === 'function') {
        teardown();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies full deps
  }, [isFocused, delayMs, ...deps]);
}
