import type { QueryKey } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { useIsFocused } from '@react-navigation/native';

import {
  applyMeetingDetailSnapshotFromListUpdate,
  findMeetingInMeetingsListCaches,
  meetingParticipantListCacheSignature,
} from '@/src/lib/meeting-detail-cache-mutations';
import { meetingDetailQueryKey } from '@/src/lib/meeting-detail-query-keys';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { Meeting } from '@/src/lib/meetings';
import { wasRecentSelfMeetingChange } from '@/src/lib/self-meeting-change';

function meetingUpdatedAtMs(m: Meeting): number {
  try {
    return m.updatedAt?.toMillis?.() ?? 0;
  } catch {
    return 0;
  }
}

function isMeetingsListCacheQueryKey(queryKey: QueryKey): boolean {
  if (!Array.isArray(queryKey) || queryKey.length < 2) return false;
  if (queryKey[0] !== 'meetings') return false;
  return queryKey[1] === 'feed' || queryKey[1] === 'my-feed';
}

/**
 * 모임 목록 캐시(my-feed·피드)가 상세보다 새로우면 상세 스냅샷을 1회 맞춥니다.
 * (목록 증분 sync가 상세 캐시를 건너뛴 경우·상세 화면 체류 중 목록만 갱신된 경우)
 */
export function useMeetingDetailFeedReconcile(
  meetingId: string,
  viewerUserId: string | null | undefined,
  currentMeeting: Meeting | null | undefined,
): void {
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const id = typeof meetingId === 'string' ? meetingId.trim() : '';
  const uid = viewerUserId?.trim() ?? '';
  const lastAppliedListSigRef = useRef<string | null>(null);

  const reconcileOnce = useCallback(() => {
    if (!isFocused || !id || !uid) return;
    if (wasRecentSelfMeetingChange(id)) return;

    const detailMeeting =
      queryClient.getQueryData<Meeting | null>(meetingDetailQueryKey(id)) ?? currentMeeting ?? null;
    if (!detailMeeting || !isUserJoinedMeeting(detailMeeting, uid)) return;

    const fromList = findMeetingInMeetingsListCaches(queryClient, id, uid);
    if (!fromList) return;

    const listHasViewer = isUserJoinedMeeting(fromList, uid);
    if (!listHasViewer) {
      /** 참여 직후 목록 캐시가 아직 본인을 participantIds에 넣기 전 — 상세를 목록으로 덮으면 참여 UI가 되돌아감 */
      return;
    }
    if (meetingUpdatedAtMs(fromList) < meetingUpdatedAtMs(detailMeeting)) return;

    const listSig = meetingParticipantListCacheSignature(fromList);
    const detailSig = meetingParticipantListCacheSignature(detailMeeting);
    if (listSig === detailSig) {
      lastAppliedListSigRef.current = listSig;
      return;
    }
    if (lastAppliedListSigRef.current === listSig) return;

    lastAppliedListSigRef.current = listSig;
    void applyMeetingDetailSnapshotFromListUpdate(queryClient, fromList);
  }, [currentMeeting, id, isFocused, queryClient, uid]);

  useEffect(() => {
    lastAppliedListSigRef.current = null;
  }, [id]);

  useEffect(() => {
    if (!isFocused || !id) return undefined;
    reconcileOnce();
    return queryClient.getQueryCache().subscribe((event) => {
      const q = event?.query;
      if (!q || !isMeetingsListCacheQueryKey(q.queryKey)) return;
      reconcileOnce();
    });
  }, [id, isFocused, queryClient, reconcileOnce]);
}
