import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';

type SyncOnScreenFocusOptions = {
  /** 초기 화면 진입은 기존 mount effect가 담당하는 화면에서 중복 호출을 피합니다. */
  skipInitial?: boolean;
  /** 빠른 라우트 전환·중복 focus 이벤트의 연속 호출을 줄입니다. */
  cooldownMs?: number;
  enabled?: boolean;
};

export function useSyncOnScreenFocus(
  sync: () => void | Promise<void>,
  deps: readonly unknown[],
  options?: SyncOnScreenFocusOptions,
) {
  const didFocusOnceRef = useRef(false);
  const lastRunAtRef = useRef(0);
  const enabled = options?.enabled ?? true;
  const skipInitial = options?.skipInitial ?? true;
  const cooldownMs = options?.cooldownMs ?? 1200;

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      if (skipInitial && !didFocusOnceRef.current) {
        didFocusOnceRef.current = true;
        return undefined;
      }
      didFocusOnceRef.current = true;
      const now = Date.now();
      if (now - lastRunAtRef.current < cooldownMs) return undefined;
      lastRunAtRef.current = now;
      void Promise.resolve(sync()).catch(() => {});
      return undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, skipInitial, cooldownMs, sync, ...deps]),
  );
}
