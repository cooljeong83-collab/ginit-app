import { skipToken, useIsRestoring, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { Meeting } from '@/src/lib/meetings';
import { getMeetingById, subscribeMeetingById } from '@/src/lib/meetings';

export function meetingDetailQueryKey(meetingId: string) {
  return ['meeting', meetingId] as const;
}

const STALE_MS = 1000 * 60 * 5;
const GC_MS = 24 * 60 * 60 * 1000;

/**
 * 모임 상세: TanStack Query + AsyncStorage 영구 캐시, 실시간 구독으로 캐시 동기화.
 */
export function useMeetingDetailQuery(meetingId: string, retryNonce: number) {
  const queryClient = useQueryClient();
  const id = typeof meetingId === 'string' ? meetingId.trim() : '';
  const isRestoring = useIsRestoring();
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const cacheLogIdRef = useRef<string | null>(null);

  const query = useQuery({
    queryKey: id ? meetingDetailQueryKey(id) : meetingDetailQueryKey('__none'),
    queryFn:
      id.length > 0
        ? async () => {
            console.log('📡 모임 상세 서버 동기화 중...');
            return getMeetingById(id);
          }
        : skipToken,
    staleTime: STALE_MS,
    gcTime: GC_MS,
  });

  type MeetingDetailQuerySnapshot = {
    data: Meeting | null | undefined;
    error: Error | null;
    isError: boolean;
    status: 'pending' | 'error' | 'success';
    fetchStatus: 'fetching' | 'paused' | 'idle';
    refetch: () => unknown;
  };

  const q = query as unknown as MeetingDetailQuerySnapshot;

  useEffect(() => {
    cacheLogIdRef.current = null;
  }, [id]);

  useEffect(() => {
    if (isRestoring || !id) return;
    if (cacheLogIdRef.current === id) return;
    const cached = queryClient.getQueryData<Meeting | null>(meetingDetailQueryKey(id));
    if (cached !== undefined) {
      console.log('📦 모임 상세 캐시 로드: ' + id);
      cacheLogIdRef.current = id;
    }
  }, [id, isRestoring, queryClient]);

  useEffect(() => {
    if (!id) {
      setSubscriptionError(null);
      return;
    }
    setSubscriptionError(null);
    let alive = true;
    const unsub = subscribeMeetingById(
      id,
      (m) => {
        if (!alive) return;
        queryClient.setQueryData(meetingDetailQueryKey(id), m);
        setSubscriptionError(null);
      },
      (msg) => {
        if (!alive) return;
        setSubscriptionError(msg);
      },
    );
    return () => {
      alive = false;
      unsub();
    };
  }, [id, retryNonce, queryClient]);

  const meeting = q.data !== undefined ? q.data : null;

  const queryErrorMsg =
    q.error instanceof Error ? q.error.message : q.error ? String(q.error) : null;

  const loadError = subscriptionError ?? queryErrorMsg;

  const hasFetched = q.data !== undefined || q.isError;

  const loading =
    Boolean(id) &&
    loadError == null &&
    !hasFetched &&
    (q.status === 'pending' || q.fetchStatus === 'fetching');

  return {
    meeting,
    loading,
    loadError,
    refetch: () => void q.refetch(),
  };
}
