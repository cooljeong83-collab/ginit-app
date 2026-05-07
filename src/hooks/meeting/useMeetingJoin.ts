import { meetingDetailQueryKey } from '@/src/hooks/use-meeting-detail-query';
import { getPolicy } from '@/src/lib/app-policies-store';
import {
  assertNoConfirmedScheduleOverlapHybrid,
  getScheduleOverlapBufferHours,
  GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION,
  isConfirmedScheduleOverlapErrorMessage,
} from '@/src/lib/meeting-schedule-overlap';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { resetStackToTabsAfterMeetingLeave } from '@/src/lib/router-safe';
import { notifyTrustPenaltyAppliedFireAndForget } from '@/src/lib/trust-penalty-notify';
import type { SelectedMovieExtra } from '@/src/lib/meeting-extra-data';
import type { Meeting } from '@/src/lib/meetings';
import {
  applyTrustPenaltyLeaveConfirmedMeeting,
  cancelJoinRequest,
  isUserKickedFromMeeting,
  joinMeeting,
  leaveMeeting,
  MEETING_JOIN_REQUEST_MESSAGE_MAX_LEN,
  meetingPrimaryStartMs,
  requestJoinMeeting,
} from '@/src/lib/meetings';
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
  const [joinOverlapBufferHours, setJoinOverlapBufferHours] = useState(3);

  const [leaveBusy, setLeaveBusy] = useState(false);

  useEffect(() => {
    if (!meeting || !sessionPk) {
      setJoinScheduleOverlapBlock(false);
      return;
    }
    if (alreadyJoinedMeeting || isHost) {
      setJoinScheduleOverlapBlock(false);
      return;
    }
    if (meeting.scheduleConfirmed !== true) {
      setJoinScheduleOverlapBlock(false);
      return;
    }
    const startMs = meetingPrimaryStartMs(meeting);
    if (startMs == null) {
      setJoinScheduleOverlapBlock(false);
      return;
    }
    let alive = true;
    void (async () => {
      let buf = 3;
      try {
        const prof = await getUserProfile(sessionPk);
        buf = getScheduleOverlapBufferHours(prof);
        await assertNoConfirmedScheduleOverlapHybrid({
          appUserId: sessionPk,
          startMs,
          bufferHours: buf,
          excludeMeetingId: meeting.id,
        });
        if (alive) {
          setJoinOverlapBufferHours(buf);
          setJoinScheduleOverlapBlock(false);
        }
      } catch {
        if (alive) {
          setJoinOverlapBufferHours(buf);
          setJoinScheduleOverlapBlock(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [meeting, sessionPk, alreadyJoinedMeeting, isHost, meeting?.id, meeting?.scheduleConfirmed, appPoliciesVersion]);

  const handleJoinMeeting = useCallback(async () => {
    if (!meeting) return;
    if (!sessionPk) {
      Alert.alert('안내', '로그인 후 참여할 수 있어요.');
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
      const joinVotes =
        meeting.scheduleConfirmed === true
          ? { dateChipIds: [] as string[], placeChipIds: [] as string[], movieChipIds: [] as string[] }
          : { dateChipIds: effectiveDateIds, placeChipIds: effectivePlaceIds, movieChipIds: effectiveMovieIds };
      await joinMeeting(meeting.id, sessionPk, joinVotes);
      void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
    } catch (e) {
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
  ]);

  const proceedJoinRequestSubmit = useCallback(
    async (messageFromModal: string | null) => {
      if (!meeting) return;
      if (!sessionPk) {
        Alert.alert('안내', '로그인 후 신청할 수 있어요.');
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
        const joinVotes =
          meeting.scheduleConfirmed === true
            ? { dateChipIds: [] as string[], placeChipIds: [] as string[], movieChipIds: [] as string[] }
            : { dateChipIds: effectiveDateIds, placeChipIds: effectivePlaceIds, movieChipIds: effectiveMovieIds };
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
    const penaltyCfg = confirmed
      ? getPolicy<{ xp?: number; trust?: number }>('trust', 'penalty_leave_confirmed', { xp: -30, trust: -12 })
      : null;
    const trustDrop =
      confirmed && penaltyCfg && typeof penaltyCfg.trust === 'number' && Number.isFinite(penaltyCfg.trust)
        ? Math.abs(Math.trunc(penaltyCfg.trust))
        : 12;
    const xpDrop =
      confirmed && penaltyCfg && typeof penaltyCfg.xp === 'number' && Number.isFinite(penaltyCfg.xp)
        ? Math.abs(Math.trunc(penaltyCfg.xp))
        : 30;
    const baseMsg = '참여를 취소하면 내가 넣었던 투표는 집계에서 빠져요. 다시 들어오려면 참여 절차가 필요해요.';
    const penaltyMsg = confirmed
      ? `\n\n일정이 확정된 모임이에요. 나가면 gTrust가 약 ${trustDrop}점 낮아지고, XP가 ${xpDrop} 감소하며 누적 패널티가 1회 늘어납니다.`
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
              void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
              let penaltyLedgerOk = false;
              if (confirmed) {
                try {
                  await applyTrustPenaltyLeaveConfirmedMeeting(sessionPk, meeting.id);
                  penaltyLedgerOk = true;
                } catch {
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

