import type { QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { meetingDetailQueryKey } from '@/src/hooks/use-meeting-detail-query';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { runMeetingsListIncrementalReconcile } from '@/src/lib/meetings-feed-incremental-sync-core';
import { getMeetingById } from '@/src/lib/meetings';

const MEETING_PUSH_PREFETCH_STALE_MS = 5 * 60 * 1000;

/** FCM `data` 페이로드를 문자열 맵으로 정규화 */
export function normalizeFcmStringMap(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) out[k] = t;
    } else {
      const s = String(v).trim();
      if (s) out[k] = s;
    }
  }
  return out;
}

export function extractMeetingIdFromPushData(data: Record<string, string>): string | null {
  const mid = (data.meeting_id || data.meetingId || '').trim();
  return mid || null;
}

/**
 * 푸시에 `meeting_id` / `meetingId`가 있으면 TanStack Query 캐시만 타깃 갱신.
 * - 포그라운드: 해당 모임 상세 invalidate + 목록은 `runMeetingsListIncrementalReconcile`(증분)
 * - 백그라운드·비활성: 상세 `prefetchQuery` 후 동일 증분(성공 시각은 reconcile 내부에서만 갱신)
 */
export function applyMeetingPushTargetedRefresh(
  qc: QueryClient,
  data: Record<string, string> | undefined,
  source: string,
  viewerAppUserId?: string | null,
): void {
  const d = data ?? {};
  const mid = extractMeetingIdFromPushData(d);
  if (!mid) return;

  const appState = AppState.currentState;
  const uid = viewerAppUserId?.trim() ? viewerAppUserId.trim() : null;
  ginitNotifyDbg('meeting-push-refresh', 'run', { meetingId: mid, source, appState });

  if (appState === 'active') {
    void qc.invalidateQueries({ queryKey: meetingDetailQueryKey(mid) });
    void runMeetingsListIncrementalReconcile(qc, uid);
    return;
  }

  void (async () => {
    try {
      await qc.prefetchQuery({
        queryKey: meetingDetailQueryKey(mid),
        queryFn: () => getMeetingById(mid),
        staleTime: MEETING_PUSH_PREFETCH_STALE_MS,
      });
    } catch {
      /* ignore */
    }
    await runMeetingsListIncrementalReconcile(qc, uid);
  })();
}
