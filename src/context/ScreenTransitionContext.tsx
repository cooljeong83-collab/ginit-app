import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ScreenTransitionRunOptions = {
  label?: string;
  settleDelayMs?: number;
  timeoutMs?: number;
};

type ScreenTransitionContextValue = {
  active: boolean;
  label: string;
  runWithTransition: <T>(task: () => Promise<T> | T, opts?: ScreenTransitionRunOptions) => Promise<T>;
};

const ScreenTransitionContext = createContext<ScreenTransitionContextValue | null>(null);

const DEFAULT_LABEL = '화면을 불러오는 중…';
const DEFAULT_SETTLE_DELAY_MS = 360;
const DEFAULT_TIMEOUT_MS = 7000;

export function ScreenTransitionProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState(DEFAULT_LABEL);
  const serialRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failsafeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (failsafeTimerRef.current) {
      clearTimeout(failsafeTimerRef.current);
      failsafeTimerRef.current = null;
    }
  }, []);

  const finish = useCallback((serial: number, settleDelayMs: number) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (serialRef.current !== serial) return;
      setActive(false);
      setLabel(DEFAULT_LABEL);
      clearTimers();
    }, Math.max(0, settleDelayMs));
  }, [clearTimers]);

  const runWithTransition = useCallback(
    async <T,>(task: () => Promise<T> | T, opts?: ScreenTransitionRunOptions): Promise<T> => {
      const serial = serialRef.current + 1;
      serialRef.current = serial;
      clearTimers();
      setLabel(opts?.label?.trim() || DEFAULT_LABEL);
      setActive(true);

      failsafeTimerRef.current = setTimeout(() => {
        if (serialRef.current !== serial) return;
        setActive(false);
        setLabel(DEFAULT_LABEL);
        clearTimers();
      }, Math.max(1000, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS));

      try {
        return await task();
      } finally {
        finish(serial, opts?.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS);
      }
    },
    [clearTimers, finish],
  );

  const value = useMemo(
    () => ({
      active,
      label,
      runWithTransition,
    }),
    [active, label, runWithTransition],
  );

  return <ScreenTransitionContext.Provider value={value}>{children}</ScreenTransitionContext.Provider>;
}

export function useScreenTransition() {
  const ctx = useContext(ScreenTransitionContext);
  if (!ctx) {
    throw new Error('useScreenTransition must be used within ScreenTransitionProvider');
  }
  return ctx;
}
