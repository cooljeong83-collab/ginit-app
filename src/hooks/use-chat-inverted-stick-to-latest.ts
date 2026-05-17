import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** inverted FlashList: offset 0 근처 = 최신(입력창 쪽) */
export const CHAT_INVERTED_NEAR_LATEST_OFFSET_PX = 56;

/** 이보다 크게 올라가 있을 때만「과거 읽기」로 간주(새 tail prepend 오판 완화) */
const INTENTIONAL_HISTORY_OFFSET_PX = 140;

/** prepend·stick 직후 inverted offset 튐 무시(ms) */
const SCROLL_IGNORE_AFTER_STICK_MS = 320;

/** 가변 높이 셀 레이아웃 전 stick — 여러 시점 재시도(ms) */
const STICK_RETRY_DELAYS_MS = [0, 48, 120, 220] as const;

type UseChatInvertedStickToLatestArgs = {
  scrollToOffsetSafe: (offset: number, animated?: boolean) => boolean;
  /** inverted index 0 = 최신. 가변 높이 말풍선용 */
  scrollToIndexSafe?: (index: number, viewPosition?: number, animated?: boolean) => boolean;
  latestMessageId: string;
  messagesEmpty: boolean;
  keyboardHeight: number;
};

/**
 * inverted 채팅 리스트: 최신 메시지가 추가될 때 offset=0(및 index 0)으로 붙입니다.
 * FlashList 가변 높이·prepend offset 튐·composer 패딩 변경 레이스를 완화합니다.
 */
export function useChatInvertedStickToLatest({
  scrollToOffsetSafe,
  scrollToIndexSafe,
  latestMessageId,
  messagesEmpty,
  keyboardHeight,
}: UseChatInvertedStickToLatestArgs) {
  const [showJumpToBottomFab, setShowJumpToBottomFab] = useState(false);
  const lastScrollOffsetRef = useRef(0);
  const userViewingHistoryRef = useRef(false);
  const stickInFlightRef = useRef(false);
  const pendingStickToLatestRef = useRef(false);
  const lastStuckMessageIdRef = useRef('');
  /** 아직 offset 확인 전 — 성공 시에만 lastStuck에 반영 */
  const stickTargetMessageIdRef = useRef('');
  const scrollIgnoreUntilRef = useRef(0);
  const stickBurstTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const isNearLatestOffset = useCallback(
    () => lastScrollOffsetRef.current <= CHAT_INVERTED_NEAR_LATEST_OFFSET_PX,
    [],
  );

  const clearStickBurst = useCallback(() => {
    for (const t of stickBurstTimersRef.current) clearTimeout(t);
    stickBurstTimersRef.current = [];
  }, []);

  const shouldStickToLatestNow = useCallback(() => {
    return (
      keyboardHeight > 0 ||
      pendingStickToLatestRef.current ||
      !userViewingHistoryRef.current ||
      isNearLatestOffset()
    );
  }, [keyboardHeight, isNearLatestOffset]);

  const tryConfirmStuckForTarget = useCallback(() => {
    const target = stickTargetMessageIdRef.current.trim();
    if (!target) return false;
    if (!isNearLatestOffset() && !pendingStickToLatestRef.current && keyboardHeight <= 0) {
      return false;
    }
    lastStuckMessageIdRef.current = target;
    stickTargetMessageIdRef.current = '';
    pendingStickToLatestRef.current = false;
    userViewingHistoryRef.current = false;
    setShowJumpToBottomFab(false);
    return true;
  }, [keyboardHeight, isNearLatestOffset]);

  const runStickToLatest = useCallback(() => {
    stickInFlightRef.current = true;
    scrollIgnoreUntilRef.current = Date.now() + SCROLL_IGNORE_AFTER_STICK_MS;

    const apply = () => {
      scrollToIndexSafe?.(0, 0, false);
      const ok = scrollToOffsetSafe(0, false);
      if (ok) {
        lastScrollOffsetRef.current = 0;
      }
    };

    apply();
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });

    setTimeout(() => {
      stickInFlightRef.current = false;
      tryConfirmStuckForTarget();
    }, 140);
    return true;
  }, [scrollToOffsetSafe, scrollToIndexSafe, tryConfirmStuckForTarget]);

  const scheduleStickBurst = useCallback(
    (messageId?: string) => {
      if (!shouldStickToLatestNow()) return;
      const mid = (messageId ?? latestMessageId).trim();
      if (mid) {
        stickTargetMessageIdRef.current = mid;
      }
      clearStickBurst();
      for (const delay of STICK_RETRY_DELAYS_MS) {
        const t = setTimeout(() => {
          if (!shouldStickToLatestNow()) return;
          runStickToLatest();
          tryConfirmStuckForTarget();
        }, delay);
        stickBurstTimersRef.current.push(t);
      }
    },
    [clearStickBurst, latestMessageId, runStickToLatest, shouldStickToLatestNow, tryConfirmStuckForTarget],
  );

  const scheduleStickToLatest = useCallback(() => {
    scheduleStickBurst(latestMessageId);
  }, [latestMessageId, scheduleStickBurst]);

  const markPendingStickToLatest = useCallback(() => {
    pendingStickToLatestRef.current = true;
  }, []);

  const onChatScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      const y = contentOffset.y;
      lastScrollOffsetRef.current = y;

      const viewH = layoutMeasurement.height;
      const contentH = contentSize.height;
      if (viewH <= 0 || contentH <= 0) {
        if (!stickInFlightRef.current) {
          userViewingHistoryRef.current = false;
          setShowJumpToBottomFab(false);
        }
        if (stickTargetMessageIdRef.current) tryConfirmStuckForTarget();
        return;
      }
      if (contentH <= viewH + 4) {
        if (!stickInFlightRef.current) {
          userViewingHistoryRef.current = false;
          setShowJumpToBottomFab(false);
        }
        if (stickTargetMessageIdRef.current) tryConfirmStuckForTarget();
        return;
      }

      const ignoringJitter = Date.now() < scrollIgnoreUntilRef.current;

      if (stickInFlightRef.current || ignoringJitter) {
        if (y <= CHAT_INVERTED_NEAR_LATEST_OFFSET_PX) {
          if (stickInFlightRef.current) stickInFlightRef.current = false;
          userViewingHistoryRef.current = false;
          setShowJumpToBottomFab(false);
          tryConfirmStuckForTarget();
        }
        return;
      }

      const away = y > CHAT_INVERTED_NEAR_LATEST_OFFSET_PX;
      userViewingHistoryRef.current = away;
      setShowJumpToBottomFab(away);

      if (!away && stickTargetMessageIdRef.current) {
        tryConfirmStuckForTarget();
      }
    },
    [tryConfirmStuckForTarget],
  );

  const onChatListContentSizeChange = useCallback(() => {
    if (messagesEmpty) return;
    if (!shouldStickToLatestNow()) return;
    const mid = latestMessageId.trim();
    if (!mid) return;
    if (lastStuckMessageIdRef.current === mid && !stickTargetMessageIdRef.current) return;
    scheduleStickBurst(mid);
  }, [latestMessageId, messagesEmpty, scheduleStickBurst, shouldStickToLatestNow]);

  const jumpToLatest = useCallback(() => {
    userViewingHistoryRef.current = false;
    pendingStickToLatestRef.current = false;
    stickTargetMessageIdRef.current = latestMessageId.trim();
    setShowJumpToBottomFab(false);
    clearStickBurst();
    requestAnimationFrame(() => {
      scheduleStickBurst(latestMessageId);
    });
  }, [clearStickBurst, latestMessageId, scheduleStickBurst]);

  const stickWhenNearLatestOnLayoutChange = useCallback(() => {
    if (userViewingHistoryRef.current && !pendingStickToLatestRef.current && keyboardHeight <= 0) {
      return;
    }
    if (lastScrollOffsetRef.current > CHAT_INVERTED_NEAR_LATEST_OFFSET_PX && userViewingHistoryRef.current) {
      return;
    }
    scheduleStickBurst(latestMessageId);
  }, [keyboardHeight, latestMessageId, scheduleStickBurst]);

  useLayoutEffect(() => {
    if (messagesEmpty) {
      setShowJumpToBottomFab(false);
      lastStuckMessageIdRef.current = '';
      stickTargetMessageIdRef.current = '';
      clearStickBurst();
      return;
    }
    const mid = latestMessageId.trim();
    if (!mid) return;
    if (lastStuckMessageIdRef.current === mid && !stickTargetMessageIdRef.current) return;

    if (lastScrollOffsetRef.current <= INTENTIONAL_HISTORY_OFFSET_PX) {
      userViewingHistoryRef.current = false;
    }
    if (!shouldStickToLatestNow()) return;

    pendingStickToLatestRef.current = false;
    clearStickBurst();
    scheduleStickBurst(mid);

    return () => {
      clearStickBurst();
    };
  }, [
    latestMessageId,
    messagesEmpty,
    keyboardHeight,
    clearStickBurst,
    scheduleStickBurst,
    shouldStickToLatestNow,
  ]);

  useEffect(() => () => clearStickBurst(), [clearStickBurst]);

  return {
    showJumpToBottomFab,
    onChatScroll,
    onChatListContentSizeChange,
    jumpToLatest,
    markPendingStickToLatest,
    scheduleStickToLatest,
    stickWhenNearLatestOnLayoutChange,
    lastScrollOffsetRef,
  };
}
