/** 모임 목록(공개 피드·내 모임) 서버 summary 동기화 — Realtime 수신 시 즉시 RPC하지 않고 지연 플래그만 씁니다. */

const MIN_AUTO_PROBE_INTERVAL_MS = 10 * 60 * 1000;

let pendingServerProbe = false;
/** 마지막으로 목록 관련 네트워크 조회(페이지 fetch·summary 동기화)에 성공한 시각 */
let lastListNetworkSuccessAt = 0;
let probeInFlight: Promise<void> | null = null;

export function resetMeetingsFeedDeferredSyncState(): void {
  pendingServerProbe = false;
  lastListNetworkSuccessAt = 0;
  probeInFlight = null;
}

export function markMeetingsFeedPendingServerProbe(): void {
  pendingServerProbe = true;
}

export function recordMeetingsListPageFetchedFromNetwork(): void {
  lastListNetworkSuccessAt = Date.now();
}

export async function flushMeetingsFeedPendingServerProbe(opts: {
  mode: 'manual' | 'explicit' | 'focus_auto';
  runSync: () => Promise<void>;
}): Promise<void> {
  const { mode, runSync } = opts;
  if (probeInFlight) return probeInFlight;

  if (mode === 'focus_auto') {
    if (!pendingServerProbe) return Promise.resolve();
    if (lastListNetworkSuccessAt > 0 && Date.now() - lastListNetworkSuccessAt < MIN_AUTO_PROBE_INTERVAL_MS) {
      return Promise.resolve();
    }
  } else {
    pendingServerProbe = false;
  }

  probeInFlight = (async () => {
    try {
      await runSync();
      lastListNetworkSuccessAt = Date.now();
      if (mode === 'focus_auto') pendingServerProbe = false;
    } finally {
      probeInFlight = null;
    }
  })();

  return probeInFlight;
}
