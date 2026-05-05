import { useEffect } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

/**
 * 장시간 실행 시 JS 힙·상태 변화를 추적하기 위한 개발 전용 로그.
 * 켜기: EXPO_PUBLIC_DEV_MEMORY_LOG=1 (번들에 인라인되므로 재시작/재빌드 필요)
 * - 웹: performance.memory (Chrome 계열)
 * - Hermes: HermesInternal.getRuntimeProperties() 중 힙/메모리 관련 키만 부분 로그
 */
const ENABLED =
  typeof __DEV__ !== 'undefined' &&
  __DEV__ &&
  typeof process !== 'undefined' &&
  process.env.EXPO_PUBLIC_DEV_MEMORY_LOG === '1';

function readWebMemory(): { usedJSHeapMB: number; totalJSHeapMB: number; limitMB: number } | null {
  if (Platform.OS !== 'web') return null;
  const perf = globalThis.performance as
    | { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }
    | undefined;
  const m = perf?.memory;
  if (!m) return null;
  return {
    usedJSHeapMB: Math.round(m.usedJSHeapSize / 1024 / 1024),
    totalJSHeapMB: Math.round(m.totalJSHeapSize / 1024 / 1024),
    limitMB: Math.round(m.jsHeapSizeLimit / 1024 / 1024),
  };
}

function readHermesHeapSubset(): Record<string, string> | null {
  try {
    const HI = (globalThis as unknown as { HermesInternal?: { getRuntimeProperties?: () => Record<string, unknown> } })
      .HermesInternal;
    const raw = HI?.getRuntimeProperties?.();
    if (!raw || typeof raw !== 'object') return null;
    const pick: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (/heap|alloc|byte|Committed|Footprint|memory/i.test(k)) pick[k] = String(v);
    }
    return Object.keys(pick).length ? pick : null;
  } catch {
    return null;
  }
}

export function DevMemoryDebug() {
  useEffect(() => {
    if (!ENABLED) return;

    const intervalMs = 30_000;
    let lastState: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      console.info('[dev-memory] AppState', next);
      lastState = next;
    });

    const tick = () => {
      const payload = {
        t: Date.now(),
        appState: lastState,
        webHeapMB: readWebMemory(),
        hermesPropsSubset: readHermesHeapSubset(),
        platform: Platform.OS,
      };
      console.info('[dev-memory]', JSON.stringify(payload));
    };

    tick();
    const id = setInterval(tick, intervalMs);

    return () => {
      sub.remove();
      clearInterval(id);
    };
  }, []);

  return null;
}
