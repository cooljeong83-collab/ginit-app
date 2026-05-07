import { meetingDetailQueryKey } from '@/src/hooks/use-meeting-detail-query';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { Meeting } from '@/src/lib/meetings';
import {
  approveJoinRequest,
  computeMeetingConfirmAnalysis,
  confirmMeetingSchedule,
  deleteMeetingByHost,
  hostRemoveParticipant,
  rejectJoinRequest,
  unconfirmMeetingSchedule,
} from '@/src/lib/meetings';
import { isConfirmedScheduleOverlapErrorMessage, GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION } from '@/src/lib/meeting-schedule-overlap';
import { markRecentSelfMeetingChange } from '@/src/lib/self-meeting-change';
import type { UserProfile } from '@/src/lib/user-profile';

import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';

export type HostTiePicks = { dateChipId: string | null; placeChipId: string | null; movieChipId: string | null };

type UseMeetingHostArgs = {
  meeting: Meeting | null;
  userId: string | null;
  queryClient: QueryClient;
  router: any;
  scrollToVoteBlock: (section: 'date' | 'movie' | 'place') => void;
  participantProfiles: Record<string, UserProfile>;
};

export function useMeetingHost({
  meeting,
  userId,
  queryClient,
  router,
  scrollToVoteBlock,
  participantProfiles,
}: UseMeetingHostArgs) {
  const [hostJoinRequestBusyId, setHostJoinRequestBusyId] = useState<string | null>(null);
  const hostJoinRequestActionInFlightRef = useRef(false);
  const hostKickParticipantInFlightRef = useRef(false);

  const [confirmScheduleBusy, setConfirmScheduleBusy] = useState(false);
  const [deleteMeetingBusy, setDeleteMeetingBusy] = useState(false);

  const [hostTieDateId, setHostTieDateId] = useState<string | null>(null);
  const [hostTiePlaceId, setHostTiePlaceId] = useState<string | null>(null);
  const [hostTieMovieId, setHostTieMovieId] = useState<string | null>(null);

  const hostTiePicks = useMemo<HostTiePicks>(
    () => ({ dateChipId: hostTieDateId, placeChipId: hostTiePlaceId, movieChipId: hostTieMovieId }),
    [hostTieDateId, hostTiePlaceId, hostTieMovieId],
  );

  const onHostApproveJoin = useCallback(
    (applicantId: string) => {
      if (!meeting || !userId?.trim()) return;
      const aid = applicantId.trim();
      if (!aid) return;
      if (hostJoinRequestActionInFlightRef.current) return;
      hostJoinRequestActionInFlightRef.current = true;
      void (async () => {
        setHostJoinRequestBusyId(aid);
        try {
          await approveJoinRequest(meeting.id, userId.trim(), aid);
          void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
          showTransientBottomMessage('참가 신청을 승인했어요.');
        } catch (e) {
          Alert.alert('승인 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
        } finally {
          setHostJoinRequestBusyId(null);
          hostJoinRequestActionInFlightRef.current = false;
        }
      })();
    },
    [meeting, userId, queryClient],
  );

  const onHostRejectJoin = useCallback(
    (applicantId: string) => {
      if (!meeting || !userId?.trim()) return;
      const aid = applicantId.trim();
      if (!aid) return;
      if (hostJoinRequestActionInFlightRef.current) return;
      hostJoinRequestActionInFlightRef.current = true;
      void (async () => {
        setHostJoinRequestBusyId(aid);
        try {
          await rejectJoinRequest(meeting.id, userId.trim(), aid);
          void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
          showTransientBottomMessage('참가 신청을 거절했어요.');
        } catch (e) {
          Alert.alert('처리 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
        } finally {
          setHostJoinRequestBusyId(null);
          hostJoinRequestActionInFlightRef.current = false;
        }
      })();
    },
    [meeting, userId, queryClient],
  );

  const handleHostKickParticipant = useCallback(
    (targetParticipantId: string) => {
      if (!meeting || !userId?.trim()) return;
      const tid = targetParticipantId.trim();
      if (!tid) return;
      if (meeting.scheduleConfirmed === true) return;
      const hostPk = meeting.createdBy?.trim() ? normalizeParticipantId(meeting.createdBy) : '';
      const targetPk = normalizeParticipantId(tid);
      if (hostPk && targetPk === hostPk) return;
      if (hostKickParticipantInFlightRef.current) return;
      const prof = participantProfiles[tid];
      const nickname = (prof?.nickname ?? '').trim() || '이 참여자';
      Alert.alert(
        '강제 퇴장',
        `${nickname}님을 이 모임에서 퇴장시킬까요?\n이후에는 이 모임에 다시 들어오거나 신청할 수 없어요.`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '퇴장',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                hostKickParticipantInFlightRef.current = true;
                try {
                  await hostRemoveParticipant(meeting.id, userId.trim(), tid);
                  void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
                  showTransientBottomMessage('참여자를 퇴장시켰어요.');
                } catch (e) {
                  Alert.alert('처리 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
                } finally {
                  hostKickParticipantInFlightRef.current = false;
                }
              })();
            },
          },
        ],
      );
    },
    [meeting, userId, queryClient, participantProfiles],
  );

  const handleUnconfirmMeetingSchedule = useCallback(() => {
    if (!meeting || !userId?.trim()) {
      Alert.alert('안내', '로그인한 주관자만 확정을 취소할 수 있어요.');
      return;
    }
    if (meeting.scheduleConfirmed !== true) return;
    Alert.alert(
      '확정 취소',
      '일정 확정을 되돌리면 다시 투표·확정 절차를 진행할 수 있는 상태로 바뀝니다. 취소할까요?',
      [
        { text: '닫기', style: 'cancel' },
        {
          text: '확정 취소',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setConfirmScheduleBusy(true);
              try {
                markRecentSelfMeetingChange(meeting.id);
                await unconfirmMeetingSchedule(meeting.id, userId.trim());
                void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
              } catch (e) {
                Alert.alert('처리 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
              } finally {
                setConfirmScheduleBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [meeting, userId, queryClient]);

  const handleConfirmSchedule = useCallback(() => {
    if (!meeting || !userId?.trim()) {
      Alert.alert('안내', '로그인한 주관자만 확정할 수 있어요.');
      return;
    }
    if (meeting.scheduleConfirmed === true) return;
    const analysis = computeMeetingConfirmAnalysis(meeting, hostTiePicks);
    if (!analysis.allReady && analysis.firstBlock) {
      const { section, message } = analysis.firstBlock;
      Alert.alert('동점 후보 선택 필요', message, [{ text: '확인', onPress: () => scrollToVoteBlock(section) }]);
      return;
    }
    Alert.alert(
      '일정 확정',
      '집계된 투표를 반영해 모임을 확정할까요? 이후 우측 상단에는「확정」으로 표시됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '확정',
          onPress: () => {
            void (async () => {
              setConfirmScheduleBusy(true);
              try {
                markRecentSelfMeetingChange(meeting.id);
                await confirmMeetingSchedule(meeting.id, userId.trim(), hostTiePicks);
                void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
              } catch (e) {
                const msg = e instanceof Error ? e.message : '';
                if (isConfirmedScheduleOverlapErrorMessage(msg)) {
                  showTransientBottomMessage(`${GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION}\n\n${msg}`);
                } else {
                  Alert.alert('확정 실패', msg || '다시 시도해 주세요.');
                }
              } finally {
                setConfirmScheduleBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [meeting, userId, hostTiePicks, scrollToVoteBlock, queryClient]);

  const handleDeleteMeeting = useCallback(() => {
    if (!meeting || !userId?.trim()) {
      Alert.alert('안내', '로그인한 주관자만 삭제할 수 있어요.');
      return;
    }
    if (meeting.scheduleConfirmed === true) return;
    Alert.alert(
      '모임 삭제',
      '이 모임을 삭제하면 참여자·투표 등 모든 정보가 사라지며 되돌릴 수 없습니다. 삭제할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeleteMeetingBusy(true);
              try {
                markRecentSelfMeetingChange(meeting.id);
                await deleteMeetingByHost(meeting.id, userId.trim());
                void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
                router.push('/(tabs)');
              } catch (e) {
                Alert.alert('삭제 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
              } finally {
                setDeleteMeetingBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [meeting, userId, router, queryClient]);

  return {
    hostJoinRequestBusyId,
    onHostApproveJoin,
    onHostRejectJoin,
    hostJoinRequestActionInFlightRef,

    handleHostKickParticipant,
    hostKickParticipantInFlightRef,

    confirmScheduleBusy,
    handleConfirmSchedule,
    handleUnconfirmMeetingSchedule,

    deleteMeetingBusy,
    handleDeleteMeeting,

    hostTieDateId,
    setHostTieDateId,
    hostTiePlaceId,
    setHostTiePlaceId,
    hostTieMovieId,
    setHostTieMovieId,
    hostTiePicks,
  };
}

