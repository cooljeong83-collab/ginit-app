import { meetingDetailQueryKey } from '@/src/hooks/use-meeting-detail-query';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import {
  patchMeetingDetailInWatermelon,
  restoreMeetingDetailInWatermelon,
} from '@/src/lib/meeting-detail-watermelon-cache';
import { refreshMeetingDetailCaches } from '@/src/lib/meeting-detail-cache-mutations';
import { isMeetingNotFoundError, purgeDeletedMeetingLocally } from '@/src/lib/meeting-deleted-local-purge';
import { getPolicy } from '@/src/lib/app-policies-store';
import {
  GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION,
  getScheduleOverlapBufferHours,
  isConfirmedScheduleOverlapErrorMessage,
} from '@/src/lib/meeting-schedule-overlap';
import {
  getTrustPenaltyLeaveNearMeetingTier,
  parseNearMeetingCancelPenaltyWindowPolicy,
} from '@/src/lib/meeting-schedule-times';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { resetStackToTabsAfterMeetingLeave } from '@/src/lib/router-safe';
import { notifyTrustPenaltyAppliedFireAndForget } from '@/src/lib/trust-penalty-notify';
import type { SelectedMovieExtra } from '@/src/lib/meeting-extra-data';
import type { Meeting } from '@/src/lib/meetings';
import {
  applyTrustPenaltyLeaveConfirmedMeeting,
  cancelJoinRequest,
  getMeetingRecruitmentPhase,
  isUserKickedFromMeeting,
  joinMeeting,
  leaveMeeting,
  MEETING_JOIN_REQUEST_MESSAGE_MAX_LEN,
  requestJoinMeeting,
} from '@/src/lib/meetings';
import {
  applyMeetingParticipantLeaveToFeedCaches,
  meetingSnapshotAfterParticipantLeave,
} from '@/src/lib/meeting-sync-service';
import { markRecentSelfMeetingChange } from '@/src/lib/self-meeting-change';
import { ensureUserProfile, getUserProfile, meetingDemographicsIncomplete } from '@/src/lib/user-profile';

import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';

type VoteSection = 'date' | 'movie' | 'place';

function movieCandidateChipId(mv: SelectedMovieExtra, index: number): string {
  const mid = String(mv.id ?? '').trim();
  if (mid) return `${mid}#${index}`;
  return `movie-${index}`;
}

function alertMeetingDeletedAndGoBack(router: UseMeetingJoinArgs['router']): void {
  Alert.alert('삭제된 모임', '이 모임은 더 이상 존재하지 않아요.', [{ text: '확인', onPress: () => router.back() }]);
}

type UseMeetingJoinArgs = {
  meeting: Meeting | null;
  sessionPk: string | null;
  queryClient: QueryClient;
  router: any;

  isHost: boolean;
  alreadyJoinedMeeting: boolean;
  appPoliciesVersion: number;

  // vote 파생/선택
  guestVotesReady: boolean;
  needsDatePick: boolean;
  needsPlacePick: boolean;
  needsMoviePick: boolean;
  autoDatePick: boolean;
  autoPlacePick: boolean;
  autoMoviePick: boolean;
  dateChips: readonly { id: string }[];
  placeChips: readonly { id: string }[];
  extraMovies: readonly SelectedMovieExtra[];
  selectedDateIds: readonly string[];
  selectedPlaceIds: readonly string[];
  selectedMovieIds: readonly string[];

  publicMeetingDetails: { requestMessageEnabled?: boolean | null } | null;

  scrollToVoteBlock: (section: VoteSection) => void;
};

export function useMeetingJoin({
  meeting,
  sessionPk,
  queryClient,
  router,
  isHost,
  alreadyJoinedMeeting,
  appPoliciesVersion,
  guestVotesReady,
  needsDatePick,
  needsPlacePick,
  needsMoviePick,
  autoDatePick,
  autoPlacePick,
  autoMoviePick,
  dateChips,
  placeChips,
  extraMovies,
  selectedDateIds,
  selectedPlaceIds,
  selectedMovieIds,
  publicMeetingDetails,
  scrollToVoteBlock,
}: UseMeetingJoinArgs) {
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinRequestMessageOpen, setJoinRequestMessageOpen] = useState(false);
  const [joinRequestDraftMessage, setJoinRequestDraftMessage] = useState('');
  const [joinScheduleOverlapBlock, setJoinScheduleOverlapBlock] = useState(false);
  const [joinOverlapBufferHours, setJoinOverlapBufferHours] = useState(() => getScheduleOverlapBufferHours(null));

  const [leaveBusy, setLeaveBusy] = useState(false);

  useEffect(() => {
    setJoinOverlapBufferHours(getScheduleOverlapBufferHours(null));
  }, [appPoliciesVersion]);

  useEffect(() => {
    if (!meeting || !sessionPk) {
      setJoinScheduleOverlapBlock(false);
      return;
    }
    if (alreadyJoinedMeeting || isHost) {
      setJoinScheduleOverlapBlock(false);
      return;
    }
    // 일정 확정 후 비참여자는 참여·신청 자체가 막힘 — 겹침 안내용 이펙트 불필요
    setJoinScheduleOverlapBlock(false);
  }, [meeting, sessionPk, alreadyJoinedMeeting, isHost, meeting?.id]);

  const handleJoinMeeting = useCallback(async () => {
    if (!meeting) return;
    if (!sessionPk) {
      Alert.alert('안내', '로그인 후 참여할 수 있어요.');
      return;
    }
    if (meeting.scheduleConfirmed === true) {
      Alert.alert('참여 불가', '이미 일정이 확정된 모임이라 참여할 수 없어요.');
      return;
    }
    if (getMeetingRecruitmentPhase(meeting) === 'full') {
      Alert.alert('정원 마감', '이미 정원이 가득 찬 모임이라 참여할 수 없어요.');
      return;
    }
    const effectiveDateIds = autoDatePick && dateChips[0]?.id ? [dateChips[0].id] : [...selectedDateIds];
    const effectivePlaceIds = autoPlacePick && placeChips[0]?.id ? [placeChips[0].id] : [...selectedPlaceIds];
    const effectiveMovieIds =
      autoMoviePick && extraMovies[0] ? [movieCandidateChipId(extraMovies[0], 0)] : [...selectedMovieIds];
    if (!guestVotesReady) {
      const parts: string[] = [];
      if (needsDatePick && effectiveDateIds.length === 0) parts.push('일시');
      if (needsPlacePick && effectivePlaceIds.length === 0) parts.push('장소');
      if (needsMoviePick && effectiveMovieIds.length === 0) parts.push('영화');
      const firstScrollSection: VoteSection | null =
        needsDatePick && !autoDatePick && effectiveDateIds.length === 0
          ? 'date'
          : needsMoviePick && !autoMoviePick && effectiveMovieIds.length === 0
            ? 'movie'
            : needsPlacePick && !autoPlacePick && effectivePlaceIds.length === 0
              ? 'place'
              : null;
      Alert.alert(
        '투표를 완료해 주세요',
        parts.length > 0
          ? `${parts.join(', ')}에서 최소 한 가지 이상 선택한 뒤 참여할 수 있어요.`
          : '각 투표에서 최소 한 가지 이상 선택한 뒤 참여할 수 있어요.',
        firstScrollSection != null ? [{ text: '확인', onPress: () => scrollToVoteBlock(firstScrollSection) }] : [{ text: '확인' }],
      );
      return;
    }
    setJoinBusy(true);
    try {
      await ensureUserProfile(sessionPk);
      const profGate = await getUserProfile(sessionPk);
      if (meetingDemographicsIncomplete(profGate, sessionPk)) {
        Alert.alert(
          '프로필을 먼저 완성해 주세요',
          'SNS 간편 가입 계정은 프로필에서 성별과 연령대를 입력한 뒤 모임에 참여할 수 있어요.',
          [
            { text: '닫기', style: 'cancel' },
            { text: '정보 등록하기', onPress: () => pushProfileOpenRegisterInfo(router as any) },
          ],
        );
        return;
      }
      const joinVotes = {
        dateChipIds: effectiveDateIds,
        placeChipIds: effectivePlaceIds,
        movieChipIds: effectiveMovieIds,
      };
      const pk = normalizeParticipantId(sessionPk) ?? sessionPk;
      const { previous } = await patchMeetingDetailInWatermelon(meeting.id, (m) => {
        const ids = new Set((m.participantIds ?? []).map((x) => String(x).trim()).filter(Boolean));
        ids.add(pk);
        return { ...m, participantIds: [...ids] };
      });
      try {
        await joinMeeting(meeting.id, sessionPk, joinVotes);
        void refreshMeetingDetailCaches(queryClient, meeting.id);
      } catch (joinErr) {
        if (isMeetingNotFoundError(joinErr)) {
          await purgeDeletedMeetingLocally(queryClient, meeting.id, sessionPk);
        } else {
          await restoreMeetingDetailInWatermelon(meeting.id, previous);
        }
        throw joinErr;
      }
    } catch (e) {
      if (isMeetingNotFoundError(e)) {
        await purgeDeletedMeetingLocally(queryClient, meeting.id, sessionPk);
        alertMeetingDeletedAndGoBack(router);
        return;
      }
      const msg = e instanceof Error ? e.message : '';
      if (isConfirmedScheduleOverlapErrorMessage(msg)) {
        showTransientBottomMessage(`${GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION}\n\n${msg}`);
      } else {
        Alert.alert('참여 실패', msg || '다시 시도해 주세요.');
      }
    } finally {
      setJoinBusy(false);
    }
  }, [
    router,
    meeting,
    sessionPk,
    queryClient,
    guestVotesReady,
    needsDatePick,
    needsPlacePick,
    needsMoviePick,
    autoDatePick,
    autoPlacePick,
    autoMoviePick,
    dateChips,
    placeChips,
    extraMovies,
    selectedDateIds,
    selectedPlaceIds,
    selectedMovieIds,
    scrollToVoteBlock,
  ]);

  const proceedJoinRequestSubmit = useCallback(
    async (messageFromModal: string | null) => {
      if (!meeting) return;
      if (!sessionPk) {
        Alert.alert('안내', '로그인 후 신청할 수 있어요.');
        return;
      }
      if (meeting.scheduleConfirmed === true) {
        Alert.alert('참여 불가', '이미 일정이 확정된 모임이라 참가 신청할 수 없어요.');
        return;
      }
      if (getMeetingRecruitmentPhase(meeting) === 'full') {
        Alert.alert('정원 마감', '이미 정원이 가득 찬 모임이라 참가 신청할 수 없어요.');
        return;
      }
      if (isUserKickedFromMeeting(meeting, sessionPk)) {
        Alert.alert('안내', '이 모임에서는 호스트에 의해 퇴장되어 다시 참여하거나 신청할 수 없어요.');
        return;
      }
      const effectiveDateIds = autoDatePick && dateChips[0]?.id ? [dateChips[0].id] : [...selectedDateIds];
      const effectivePlaceIds = autoPlacePick && placeChips[0]?.id ? [placeChips[0].id] : [...selectedPlaceIds];
      const effectiveMovieIds =
        autoMoviePick && extraMovies[0] ? [movieCandidateChipId(extraMovies[0], 0)] : [...selectedMovieIds];
      if (!guestVotesReady) {
        const parts: string[] = [];
        if (needsDatePick && effectiveDateIds.length === 0) parts.push('일시');
        if (needsPlacePick && effectivePlaceIds.length === 0) parts.push('장소');
        if (needsMoviePick && effectiveMovieIds.length === 0) parts.push('영화');
        const firstScrollSection: VoteSection | null =
          needsDatePick && !autoDatePick && effectiveDateIds.length === 0
            ? 'date'
            : needsMoviePick && !autoMoviePick && effectiveMovieIds.length === 0
              ? 'movie'
              : needsPlacePick && !autoPlacePick && effectivePlaceIds.length === 0
                ? 'place'
                : null;
        Alert.alert(
          '투표를 완료해 주세요',
          parts.length > 0
            ? `${parts.join(', ')}에서 최소 한 가지 이상 선택한 뒤 신청할 수 있어요.`
            : '각 투표에서 최소 한 가지 이상 선택한 뒤 신청할 수 있어요.',
          firstScrollSection != null ? [{ text: '확인', onPress: () => scrollToVoteBlock(firstScrollSection) }] : [{ text: '확인' }],
        );
        return;
      }
      setJoinBusy(true);
      try {
        await ensureUserProfile(sessionPk);
        const profGate = await getUserProfile(sessionPk);
        if (meetingDemographicsIncomplete(profGate, sessionPk)) {
          Alert.alert(
            '프로필을 먼저 완성해 주세요',
            'SNS 간편 가입 계정은 프로필에서 성별과 연령대를 입력한 뒤 모임에 참여할 수 있어요.',
            [
              { text: '닫기', style: 'cancel' },
              { text: '정보 등록하기', onPress: () => pushProfileOpenRegisterInfo(router as any) },
            ],
          );
          return;
        }
        const joinVotes = {
          dateChipIds: effectiveDateIds,
          placeChipIds: effectivePlaceIds,
          movieChipIds: effectiveMovieIds,
        };
        const msgTrim = (messageFromModal ?? '').trim();
        const opts =
          publicMeetingDetails?.requestMessageEnabled === true
            ? { message: msgTrim ? msgTrim.slice(0, MEETING_JOIN_REQUEST_MESSAGE_MAX_LEN) : null }
            : undefined;
        await requestJoinMeeting(meeting.id, sessionPk, joinVotes, opts);
        setJoinRequestMessageOpen(false);
        void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
        showTransientBottomMessage('참가 신청을 보냈어요. 호스트 승인을 기다려 주세요.');
      } catch (e) {
        if (isMeetingNotFoundError(e)) {
          await purgeDeletedMeetingLocally(queryClient, meeting.id, sessionPk);
          alertMeetingDeletedAndGoBack(router);
          return;
        }
        const msg = e instanceof Error ? e.message : '';
        if (isConfirmedScheduleOverlapErrorMessage(msg)) {
          showTransientBottomMessage(`${GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION}\n\n${msg}`);
        } else {
          Alert.alert('신청 실패', msg || '다시 시도해 주세요.');
        }
      } finally {
        setJoinBusy(false);
      }
    },
    [
      router,
      meeting,
      sessionPk,
      guestVotesReady,
      needsDatePick,
      needsPlacePick,
      needsMoviePick,
      autoDatePick,
      autoPlacePick,
      autoMoviePick,
      dateChips,
      placeChips,
      extraMovies,
      selectedDateIds,
      selectedPlaceIds,
      selectedMovieIds,
      queryClient,
      scrollToVoteBlock,
      publicMeetingDetails?.requestMessageEnabled,
    ],
  );

  const onPressRequestJoin = useCallback(() => {
    if (!meeting || !sessionPk) {
      Alert.alert('안내', '로그인 후 신청할 수 있어요.');
      return;
    }
    if (meeting.scheduleConfirmed === true) {
      Alert.alert('참여 불가', '이미 일정이 확정된 모임이라 참가 신청할 수 없어요.');
      return;
    }
    if (getMeetingRecruitmentPhase(meeting) === 'full') {
      Alert.alert('정원 마감', '이미 정원이 가득 찬 모임이라 참가 신청할 수 없어요.');
      return;
    }
    if (isUserKickedFromMeeting(meeting, sessionPk)) {
      Alert.alert('안내', '이 모임에서는 호스트에 의해 퇴장되어 다시 참여하거나 신청할 수 없어요.');
      return;
    }
    const effectiveDateIds = autoDatePick && dateChips[0]?.id ? [dateChips[0].id] : [...selectedDateIds];
    const effectivePlaceIds = autoPlacePick && placeChips[0]?.id ? [placeChips[0].id] : [...selectedPlaceIds];
    const effectiveMovieIds =
      autoMoviePick && extraMovies[0] ? [movieCandidateChipId(extraMovies[0], 0)] : [...selectedMovieIds];
    if (!guestVotesReady) {
      const parts: string[] = [];
      if (needsDatePick && effectiveDateIds.length === 0) parts.push('일시');
      if (needsPlacePick && effectivePlaceIds.length === 0) parts.push('장소');
      if (needsMoviePick && effectiveMovieIds.length === 0) parts.push('영화');
      const firstScrollSection: VoteSection | null =
        needsDatePick && !autoDatePick && effectiveDateIds.length === 0
          ? 'date'
          : needsMoviePick && !autoMoviePick && effectiveMovieIds.length === 0
            ? 'movie'
            : needsPlacePick && !autoPlacePick && effectivePlaceIds.length === 0
              ? 'place'
              : null;
      Alert.alert(
        '투표를 완료해 주세요',
        parts.length > 0
          ? `${parts.join(', ')}에서 최소 한 가지 이상 선택한 뒤 신청할 수 있어요.`
          : '각 투표에서 최소 한 가지 이상 선택한 뒤 신청할 수 있어요.',
        firstScrollSection != null ? [{ text: '확인', onPress: () => scrollToVoteBlock(firstScrollSection) }] : [{ text: '확인' }],
      );
      return;
    }
    if (publicMeetingDetails?.requestMessageEnabled === true) {
      setJoinRequestDraftMessage('');
      setJoinRequestMessageOpen(true);
      return;
    }
    void proceedJoinRequestSubmit(null);
  }, [
    meeting,
    sessionPk,
    guestVotesReady,
    needsDatePick,
    needsPlacePick,
    needsMoviePick,
    autoDatePick,
    autoPlacePick,
    autoMoviePick,
    dateChips,
    placeChips,
    extraMovies,
    selectedDateIds,
    selectedPlaceIds,
    selectedMovieIds,
    scrollToVoteBlock,
    publicMeetingDetails?.requestMessageEnabled,
    proceedJoinRequestSubmit,
  ]);

  const onCancelJoinRequestPress = useCallback(() => {
    if (!meeting || !sessionPk) return;
    Alert.alert('신청 취소', '참가 신청을 취소할까요?', [
      { text: '닫기', style: 'cancel' },
      {
        text: '취소하기',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setJoinBusy(true);
            try {
              await cancelJoinRequest(meeting.id, sessionPk);
              void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
              showTransientBottomMessage('참가 신청을 취소했어요.');
            } catch (e) {
              Alert.alert('안내', e instanceof Error ? e.message : '다시 시도해 주세요.');
            } finally {
              setJoinBusy(false);
            }
          })();
        },
      },
    ]);
  }, [meeting, sessionPk, queryClient]);

  const handleLeaveParticipant = useCallback(() => {
    if (!meeting || !sessionPk) {
      Alert.alert('안내', '로그인 후 탈퇴할 수 있어요.');
      return;
    }
    const confirmed = meeting.scheduleConfirmed === true;
    const winPolicyRaw = getPolicy<unknown>('trust', 'penalty_near_meeting_cancel_window_hours', {
      outer_hours: 2,
      inner_hours: 1,
    });
    const winParsed = parseNearMeetingCancelPenaltyWindowPolicy(winPolicyRaw);
    const tier = confirmed ? getTrustPenaltyLeaveNearMeetingTier(meeting, Date.now(), winParsed) : 'none';
    const withinPenaltyWindow = tier !== 'none';
    const penaltyCfg =
      tier === 'full'
        ? getPolicy<{ xp?: number; trust?: number }>('trust', 'penalty_leave_confirmed', { xp: -30, trust: -12 })
        : tier === 'soft'
          ? getPolicy<{ xp?: number; trust?: number }>('trust', 'penalty_leave_confirmed_soft', {
              xp: -15,
              trust: -6,
            })
          : null;
    const trustDrop =
      penaltyCfg && typeof penaltyCfg.trust === 'number' && Number.isFinite(penaltyCfg.trust)
        ? Math.abs(Math.trunc(penaltyCfg.trust))
        : 12;
    const xpDrop =
      penaltyCfg && typeof penaltyCfg.xp === 'number' && Number.isFinite(penaltyCfg.xp)
        ? Math.abs(Math.trunc(penaltyCfg.xp))
        : 30;
    const baseMsg = '참여를 취소하면 내가 넣었던 투표는 집계에서 빠져요. 다시 들어오려면 참여 절차가 필요해요.';
    const oh = winParsed.outerHours;
    const ih = winParsed.innerHours;
    const penaltyMsg = withinPenaltyWindow
      ? tier === 'full'
        ? `\n\n예정 시작 ${ih}시간 이내예요. 나가면 gTrust가 약 ${trustDrop}점 낮아지고, XP가 ${xpDrop} 감소하며 누적 패널티가 1회 늘어납니다.`
        : `\n\n예정 시작 ${oh}시간 이내·${ih}시간 전보다는 일찍 나가요. 나가면 gTrust가 약 ${trustDrop}점 낮아지고, XP가 ${xpDrop} 감소하며 누적 패널티가 1회 늘어납니다.`
      : confirmed
        ? `\n\n일정이 확정된 모임이에요. 예정 시작 ${oh}시간 전보다 일찍 나가면 신뢰·XP 패널티는 적용되지 않아요.`
        : '';
    Alert.alert('모임에서 나가기', baseMsg + penaltyMsg, [
      { text: '취소', style: 'cancel' },
      {
        text: '퇴장',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setLeaveBusy(true);
            try {
              await leaveMeeting(meeting.id, sessionPk);
              const leftSnapshot = meetingSnapshotAfterParticipantLeave(meeting, sessionPk);
              markRecentSelfMeetingChange(meeting.id);
              applyMeetingParticipantLeaveToFeedCaches(
                queryClient,
                meeting.id,
                sessionPk,
                leftSnapshot,
              );
              await patchMeetingDetailInWatermelon(meeting.id, () => leftSnapshot);
              queryClient.setQueryData(meetingDetailQueryKey(meeting.id), leftSnapshot);
              void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
              let penaltyLedgerOk = false;
              if (withinPenaltyWindow) {
                try {
                  // RPC는 public.profiles.app_user_id로 조회 — 행이 없으면 즉시 실패하므로 선행 보장
                  await ensureUserProfile(sessionPk);
                  await applyTrustPenaltyLeaveConfirmedMeeting(sessionPk, meeting.id);
                  penaltyLedgerOk = true;
                } catch (e) {
                  if (__DEV__) {
                    // eslint-disable-next-line no-console
                    console.warn('[useMeetingJoin] applyTrustPenaltyLeaveConfirmedMeeting failed after leave', e);
                  }
                  Alert.alert(
                    '안내',
                    '모임에서는 나갔지만 신뢰 점수 반영이 잠시 실패했어요. 프로필을 새로고침한 뒤에도 이상하면 고객 지원에 문의해 주세요.',
                  );
                }
              }
              resetStackToTabsAfterMeetingLeave(router as any, { tab: 'index' });
              if (penaltyLedgerOk) {
                if (Platform.OS === 'web') {
                  setTimeout(() => {
                    Alert.alert(
                      '신뢰 패널티가 반영됐어요',
                      `gTrust ${trustDrop}점·XP ${xpDrop}가 차감됐고, 누적 패널티가 1회 늘었어요.`,
                      [
                        { text: '닫기', style: 'cancel' },
                        { text: '프로필로', onPress: () => (router as any).push?.('/(tabs)/profile') },
                      ],
                    );
                  }, 400);
                } else {
                  notifyTrustPenaltyAppliedFireAndForget({ trustPoints: trustDrop, xpPoints: xpDrop });
                }
              }
            } catch (e) {
              Alert.alert('탈퇴 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
            } finally {
              setLeaveBusy(false);
            }
          })();
        },
      },
    ]);
  }, [meeting, sessionPk, router, queryClient]);

  return {
    joinBusy,
    joinRequestMessageOpen,
    setJoinRequestMessageOpen,
    joinRequestDraftMessage,
    setJoinRequestDraftMessage,
    joinScheduleOverlapBlock,
    joinOverlapBufferHours,

    handleJoinMeeting,
    proceedJoinRequestSubmit,
    onPressRequestJoin,
    onCancelJoinRequestPress,

    leaveBusy,
    handleLeaveParticipant,
  };
}

