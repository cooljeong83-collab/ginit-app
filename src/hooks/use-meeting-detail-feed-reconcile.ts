import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { useIsFocused } from '@react-navigation/native';

import {
  applyMeetingDetailSnapshotFromListUpdate,
  findMeetingInMeetingsListCaches,
  meetingParticipantListCacheSignature,
} from '@/src/lib/meeting-detail-cache-mutations';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { Meeting } from '@/src/lib/meetings';

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
    if (!isFocused || !id || !uid || !currentMeeting) return;
    if (!isUserJoinedMeeting(currentMeeting, uid)) return;

    const fromList = findMeetingInMeetingsListCaches(queryClient, id, uid);
    if (!fromList) return;

    const listSig = meetingParticipantListCacheSignature(fromList);
    const detailSig = meetingParticipantListCacheSignature(currentMeeting);
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
    return queryClient.getQueryCache().subscribe(() => {
      reconcileOnce();
    });
  }, [id, isFocused, queryClient, reconcileOnce]);
}
