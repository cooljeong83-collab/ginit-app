import { useEffect } from 'react';

import { ledgerWritesToSupabase } from '@/src/lib/hybrid-data-source';
import { markMeetingsFeedPendingServerProbe } from '@/src/lib/meetings-feed-deferred-sync';

const MEETINGS_FEED_PROBE_TICK_MS = 3 * 60 * 1000;

/**
 * 공개 `meetings` 테이블 Realtime 허브는 비용·메시지 폭증 방지로 비활성화되었습니다.
 * 대신 주기적으로 "서버 요약 동기화가 필요함" 플래그만 올려, 포커스/당김 경로의 flush와 맞춥니다.
 */
export function useMeetingsTableRealtimeDeferred(opts: { enabled: boolean; viewerUserId?: string | null }) {
  const { enabled } = opts;

  useEffect(() => {
    if (!enabled || !ledgerWritesToSupabase()) return undefined;
    const id = setInterval(() => {
      markMeetingsFeedPendingServerProbe();
    }, MEETINGS_FEED_PROBE_TICK_MS);
    return () => clearInterval(id);
  }, [enabled]);
}
