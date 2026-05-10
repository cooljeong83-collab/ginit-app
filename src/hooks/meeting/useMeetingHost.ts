import { meetingDetailQueryKey } from '@/src/hooks/use-meeting-detail-query';
import { getPolicy } from '@/src/lib/app-policies-store';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { ledgerWritesToSupabase } from '@/src/lib/hybrid-data-source';
import type { Meeting } from '@/src/lib/meetings';
import {
  applyTrustPenaltyHostUnconfirmConfirmedMeeting,
  approveJoinRequest,
  computeMeetingConfirmAnalysis,
  confirmMeetingSchedule,
  deleteMeetingByHost,
  hostRemoveParticipant,
  isGinitWebGuestParticipantId,
  rejectJoinRequest,
  unconfirmMeetingSchedule,
} from '@/src/lib/meetings';
import { isConfirmedScheduleOverlapErrorMessage, GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION } from '@/src/lib/meeting-schedule-overlap';
import {
  isHostScheduleUnconfirmHiddenByStartProximity,
  getTrustPenaltyLeaveNearMeetingTier,
  parseNearMeetingCancelPenaltyWindowPolicy,
} from '@/src/lib/meeting-schedule-times';
import { isLedgerMeetingId } from '@/src/lib/meetings-ledger';
import { markRecentSelfMeetingChange } from '@/src/lib/self-meeting-change';
import { notifyTrustPenaltyAppliedFireAndForget } from '@/src/lib/trust-penalty-notify';
import { ensureUserProfile } from '@/src/lib/user-profile';
import { getMeetingArrivalVerifyPolicy } from '@/src/lib/meeting-arrival-verify';

import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

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
    const arrivalPol = getMeetingArrivalVerifyPolicy();
    if (
      isHostScheduleUnconfirmHiddenByStartProximity(
        meeting,
        Date.now(),
        arrivalPol.guest_arrival_pill_visible_before_min,
      )
    ) {
      Alert.alert('안내', `모임 시작 ${arrivalPol.guest_arrival_pill_visible_before_min}분 전부터는 일정 확정을 취소할 수 없어요.`, [
        { text: '확인' },
      ]);
      return;
    }
    const winPolicyRaw = getPolicy<unknown>('trust', 'penalty_near_meeting_cancel_window_hours', {
      outer_hours: 2,
      inner_hours: 1,
    });
    const winParsed = parseNearMeetingCancelPenaltyWindowPolicy(winPolicyRaw);
    const tier = getTrustPenaltyLeaveNearMeetingTier(meeting, Date.now(), winParsed);
    const withinPenaltyWindow = tier !== 'none';
    const hostPenCfg =
      tier === 'full'
        ? getPolicy<{ xp?: number; trust?: number }>('trust', 'penalty_host_unconfirm_confirmed', {
            xp: -30,
            trust: -12,
          })
        : tier === 'soft'
          ? getPolicy<{ xp?: number; trust?: number }>('trust', 'penalty_host_unconfirm_confirmed_soft', {
              xp: -15,
              trust: -6,
            })
          : null;
    const trustDrop =
      hostPenCfg && typeof hostPenCfg.trust === 'number' && Number.isFinite(hostPenCfg.trust)
        ? Math.abs(Math.trunc(hostPenCfg.trust))
        : 12;
    const xpDrop =
      hostPenCfg && typeof hostPenCfg.xp === 'number' && Number.isFinite(hostPenCfg.xp)
        ? Math.abs(Math.trunc(hostPenCfg.xp))
        : 30;
    const baseUnconfirm =
      '일정 확정을 되돌리면 다시 투표·확정 절차를 진행할 수 있는 상태로 바뀝니다. 취소할까요?';
    const oh = winParsed.outerHours;
    const ih = winParsed.innerHours;
    const penaltyHint = withinPenaltyWindow
      ? tier === 'full'
        ? `\n\n예정 시작 ${ih}시간 이내예요. 확정을 취소하면 gTrust가 약 ${trustDrop}점 낮아지고, XP가 ${xpDrop} 감소하며 누적 패널티가 1회 늘어납니다.`
        : `\n\n예정 시작 ${oh}시간 이내·${ih}시간 전보다는 일찍 취소해요. 확정을 취소하면 gTrust가 약 ${trustDrop}점 낮아지고, XP가 ${xpDrop} 감소하며 누적 패널티가 1회 늘어납니다.`
      : `\n\n예정 시작 ${oh}시간 전보다 일찍 취소하면 신뢰·XP 패널티는 적용되지 않아요.`;
    Alert.alert('확정 취소', baseUnconfirm + penaltyHint, [
      { text: '닫기', style: 'cancel' },
      {
        text: '확정 취소',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setConfirmScheduleBusy(true);
            let hostPenaltyApplied = false;
            try {
              if (
                withinPenaltyWindow &&
                ledgerWritesToSupabase() &&
                isLedgerMeetingId(meeting.id) &&
                userId.trim()
              ) {
                try {
                  await ensureUserProfile(userId.trim());
                  await applyTrustPenaltyHostUnconfirmConfirmedMeeting(userId.trim(), meeting.id);
                  hostPenaltyApplied = true;
                } catch (e) {
                  Alert.alert(
                    '처리 실패',
                    e instanceof Error
                      ? e.message
                      : '신뢰 패널티 반영에 실패했어요. 잠시 후 다시 시도해 주세요.',
                  );
                  return;
                }
              }
              markRecentSelfMeetingChange(meeting.id);
              await unconfirmMeetingSchedule(meeting.id, userId.trim());
              void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
              if (hostPenaltyApplied) {
                if (Platform.OS === 'web') {
                  setTimeout(() => {
                    Alert.alert(
                      '신뢰 패널티가 반영됐어요',
                      `gTrust ${trustDrop}점·XP ${xpDrop}가 차감됐고, 누적 패널티가 1회 늘었어요.`,
                      [{ text: '확인' }],
                    );
                  }, 400);
                } else {
                  notifyTrustPenaltyAppliedFireAndForget({ trustPoints: trustDrop, xpPoints: xpDrop });
                }
              }
            } catch (e) {
              Alert.alert('처리 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
            } finally {
              setConfirmScheduleBusy(false);
            }
          })();
        },
      },
    ]);
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
                const hasWebGuest = (meeting.participantIds ?? []).some((id) =>
                  typeof id === 'string' && isGinitWebGuestParticipantId(id),
                );
                if (hasWebGuest) {
                  Alert.alert('확정 완료', '게스트 참여자가 있어요. 확정된 일정을 공유해 주세요.', [{ text: '확인' }]);
                }
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

