import { useCallback, useEffect, useRef } from 'react';

type CleanupFn = () => void;

/**
 * 화면(컴포넌트) 언마운트 시 리소스를 일괄 해제하기 위한 레지스트리.
 *
 * 사용 예:
 * - const { addCleanup, isMountedRef } = useUnmountCleanup();
 * - addCleanup(() => unsub());
 * - addCleanup(() => clearTimeout(t));
 * - 비동기 완료 시: if (!isMountedRef.current) return;
 */
export function useUnmountCleanup(): {
  addCleanup: (fn: CleanupFn) => CleanupFn;
  isMountedRef: React.MutableRefObject<boolean>;
} {
  const cleanupsRef = useRef<CleanupFn[]>([]);
  const isMountedRef = useRef(true);

  const addCleanup = useCallback((fn: CleanupFn) => {
    cleanupsRef.current.push(fn);
    return fn;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      const list = cleanupsRef.current;
      cleanupsRef.current = [];
      // 역순으로 해제(의존성 있는 리소스가 있는 경우를 대비)
      for (let i = list.length - 1; i >= 0; i -= 1) {
        try {
          list[i]?.();
        } catch {
          // cleanup은 best-effort
        }
      }
    };
  }, []);

  return { addCleanup, isMountedRef };
}

