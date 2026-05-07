import { meetingDetailQueryKey } from '@/src/hooks/use-meeting-detail-query';
import {
  assertDateCandidatesNoOverlapWithOtherMeetings,
  DATE_CANDIDATE_OVERLAP_BUFFER_HOURS,
  GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION,
  isConfirmedScheduleOverlapErrorMessage,
} from '@/src/lib/meeting-schedule-overlap';
import type { SelectedMovieExtra } from '@/src/lib/meeting-extra-data';
import type { DateCandidate, PlaceCandidate, VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import type { Meeting } from '@/src/lib/meetings';
import { ensureUserProfile } from '@/src/lib/user-profile';
import {
  getMeetingById,
  updateMeetingDateCandidates,
  updateMeetingPlaceCandidates,
  updateParticipantVotes,
  upsertParticipantVotes,
  getParticipantVoteSnapshot,
} from '@/src/lib/meetings';
import { markRecentSelfMeetingChange } from '@/src/lib/self-meeting-change';
import { invalidateNearbySearchBiasCache } from '@/src/lib/nearby-search-bias';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, type ScrollView } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';

import type { VoteCandidatesFormHandle } from '@/components/create/VoteCandidatesForm';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import {
  clampYmdToScheduleProposalWindow,
  createPointCandidate,
  fmtDateYmd,
  normalizeTimeInput,
} from '@/src/lib/date-candidate';

type VoteSection = 'date' | 'movie' | 'place';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function parseYmd(raw: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  return { y, m: mo, d: da };
}

function monthStartYmd(ymd: string): string {
  const p = parseYmd(ymd);
  if (!p) return fmtDateYmd(new Date());
  return `${p.y}-${pad2(p.m)}-01`;
}

/** 투표 칩·선택 상태와 동일한 id (후보에 id 없을 때 인덱스 fallback) */
function dateCandidateChipId(d: DateCandidate, index: number): string {
  return d.id?.trim() || `dc-${index}`;
}

function newDateCandidateId(): string {
  return `date-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** `startDate` + 정규화 시간 기준으로 기존 후보와 동일한 일시인지 판별 */
function dateCandidateTimeKey(d: DateCandidate): string {
  const t = normalizeTimeInput(d.startTime ?? '') || '15:00';
  return `${(typeof d.startDate === 'string' ? d.startDate : '').trim()}|${t}`;
}

/**
 * 폼에서 넘어온 일시 후보 중, 기존 문서 후보와 **같은 날짜·시간**인 것은 제외하고 뒤에 이어붙입니다.
 * 폼 안에서 서로 같은 일시가 여러 번 나와도 한 번만 추가합니다.
 */
function mergeAppendNewDateCandidatesWithoutDup(
  existing: DateCandidate[],
  fromForm: DateCandidate[],
): { merged: DateCandidate[]; additions: DateCandidate[] } {
  const mergedKeys = new Set(existing.map(dateCandidateTimeKey));
  const additions: DateCandidate[] = [];
  for (const d of fromForm) {
    const k = dateCandidateTimeKey(d);
    if (mergedKeys.has(k)) continue;
    mergedKeys.add(k);
    additions.push({
      ...d,
      id: d.id?.trim() || newDateCandidateId(),
    });
  }
  const merged = [...existing.map((x) => ({ ...x })), ...additions];
  return { merged, additions };
}

function newPlaceCandidateId(): string {
  return `place-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function placeCandidateDedupKey(p: PlaceCandidate): string {
  const lat = Number.isFinite(p.latitude) ? Math.round(p.latitude * 100000) / 100000 : 0;
  const lng = Number.isFinite(p.longitude) ? Math.round(p.longitude * 100000) / 100000 : 0;
  return `${lat}|${lng}|${p.placeName.trim().toLowerCase()}|${p.address.trim().toLowerCase()}`;
}

/**
 * 폼에서 넘어온 장소 후보 중, 기존과 **좌표·이름·주소**가 같은 항목은 제외하고 뒤에 붙입니다.
 */
function mergeAppendNewPlaceCandidatesWithoutDup(
  existing: PlaceCandidate[],
  fromForm: PlaceCandidate[],
): { merged: PlaceCandidate[]; additions: PlaceCandidate[] } {
  const keys = new Set(existing.map(placeCandidateDedupKey));
  const existingIds = new Set(existing.map((x) => String(x.id ?? '').trim()).filter(Boolean));
  const additions: PlaceCandidate[] = [];

  for (const p of fromForm) {
    const k = placeCandidateDedupKey(p);
    if (keys.has(k)) continue;
    keys.add(k);
    let pid = String(p.id ?? '').trim() || newPlaceCandidateId();
    if (existingIds.has(pid)) {
      pid = newPlaceCandidateId();
    }
    existingIds.add(pid);
    additions.push({
      ...p,
      id: pid,
      placeName: p.placeName.trim(),
      address: p.address.trim(),
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
    });
  }
  const merged = [...existing.map((x) => ({ ...x })), ...additions];
  return { merged, additions };
}

function movieCandidateChipId(mv: SelectedMovieExtra, index: number): string {
  const mid = String(mv.id ?? '').trim();
  if (mid) return `${mid}#${index}`;
  return `movie-${index}`;
}

type UseMeetingVoteArgs = {
  windowWidth: number;
  mainScrollRef: React.RefObject<ScrollView | null>;
  queryClient: QueryClient;

  meeting: Meeting | null;
  userId: string | null;
  sessionPk: string | null;
  isHost: boolean;
  alreadyJoinedMeeting: boolean;

  // 파생/외부(메인에서 계산한 값)
  dateChips: readonly { id: string }[];
  placeChips: readonly { id: string }[];
  extraMovies: readonly SelectedMovieExtra[];
  needsDatePick: boolean;
  needsPlacePick: boolean;
  needsMoviePick: boolean;
  autoDatePick: boolean;
  autoPlacePick: boolean;
  autoMoviePick: boolean;
  publicMeetingDetails: { requestMessageEnabled?: boolean | null } | null;
  insertModalSchedule: { scheduleDate: string; scheduleTime: string };
};

export function useMeetingVote({
  windowWidth,
  mainScrollRef,
  queryClient,
  meeting,
  userId,
  sessionPk,
  isHost,
  alreadyJoinedMeeting,
  dateChips,
  placeChips,
  extraMovies,
  needsDatePick,
  needsPlacePick,
  needsMoviePick,
  autoDatePick,
  autoPlacePick,
  autoMoviePick,
  publicMeetingDetails,
  insertModalSchedule,
}: UseMeetingVoteArgs) {
  const [selectedDateIds, setSelectedDateIds] = useState<string[]>([]);
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<string[]>([]);
  const [selectedMovieIds, setSelectedMovieIds] = useState<string[]>([]);

  const [dateVoteCalendarMonth, setDateVoteCalendarMonth] = useState(() => monthStartYmd(fmtDateYmd(new Date())));
  const [dateVoteCalendarPagerW, setDateVoteCalendarPagerW] = useState(() => Math.max(280, Math.floor(windowWidth)));

  const dateVoteCalendarPagerRef = useRef<ScrollView>(null);
  const dateVoteCalendarPagerIgnoreMomentumEndRef = useRef(false);
  const dateVoteCalendarCenterOpacity = useRef(new Animated.Value(1)).current;
  const dateVoteCalendarSwipeFadeAfterRecenterRef = useRef(false);
  const dateVoteCalendarFadeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const [dateVoteCalendarYmPick, setDateVoteCalendarYmPick] = useState<{ draft: Date } | null>(null);
  const [dateVoteTimePick, setDateVoteTimePick] = useState<{ ymd: string } | null>(null);

  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeFormKey, setProposeFormKey] = useState(0);
  const [proposeSaving, setProposeSaving] = useState(false);
  const voteFormRef = useRef<VoteCandidatesFormHandle>(null);

  const voteSectionScrollYs = useRef({ date: 0, movie: 0, place: 0 });
  const scrollToVoteBlock = useCallback(
    (section: VoteSection) => {
      const y = voteSectionScrollYs.current[section];
      mainScrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    },
    [mainScrollRef],
  );

  const [placeProposeOpen, setPlaceProposeOpen] = useState(false);
  const [placeProposeFormKey, setPlaceProposeFormKey] = useState(0);
  const [placeProposeSaving, setPlaceProposeSaving] = useState(false);
  const placeVoteFormRef = useRef<VoteCandidatesFormHandle>(null);

  const [participantVoteBusy, setParticipantVoteBusy] = useState(false);
  const [votePersistNonce, setVotePersistNonce] = useState(0);

  // 후보가 1개일 때도 달력 UI가 바로 보이도록, 해당 후보의 월로 자동 정렬합니다(초기 1회).
  const storedDateCandidates = meeting?.dateCandidates ?? [];
  const dateVoteMonthAutofitKeyRef = useRef<string>('');
  useEffect(() => {
    if (!meeting) return;
    if (meeting.scheduleConfirmed === true) return;
    if (storedDateCandidates.length !== 1) return;
    const ymd = String(storedDateCandidates[0]?.startDate ?? '').trim();
    if (!ymd) return;
    const key = `${meeting.id}\u0001${ymd}`;
    if (dateVoteMonthAutofitKeyRef.current === key) return;
    dateVoteMonthAutofitKeyRef.current = key;
    setDateVoteCalendarMonth(monthStartYmd(ymd));
  }, [meeting, meeting?.id, meeting?.scheduleConfirmed, storedDateCandidates]);

  const openDateProposeModal = useCallback(() => {
    setProposeFormKey((k) => k + 1);
    setProposeOpen(true);
  }, []);

  const openPlaceProposeModal = useCallback(() => {
    invalidateNearbySearchBiasCache();
    setPlaceProposeFormKey((k) => k + 1);
    setPlaceProposeOpen(true);
  }, []);

  const proposeInitialPayload = useMemo((): VoteCandidatesPayload | null => {
    if (!meeting || !proposeOpen) return null;
    const dates = [
      createPointCandidate(
        newDateCandidateId(),
        clampYmdToScheduleProposalWindow(insertModalSchedule.scheduleDate),
        insertModalSchedule.scheduleTime,
      ),
    ];
    const places: PlaceCandidate[] = meeting.placeCandidates?.length
      ? (meeting.placeCandidates.map((p) => ({ ...p })) as PlaceCandidate[])
      : [];
    return { dateCandidates: dates, placeCandidates: places };
  }, [meeting, insertModalSchedule, proposeOpen, proposeFormKey]);

  const placeProposeInitialPayload = useMemo((): VoteCandidatesPayload | null => {
    if (!meeting || !placeProposeOpen) return null;
    return { dateCandidates: [], placeCandidates: [] };
  }, [meeting, placeProposeOpen, placeProposeFormKey]);

  const confirmDateProposals = useCallback(async () => {
    if (!meeting) return;
    const cap = voteFormRef.current?.captureWizardPayloadAfterSchedule();
    if (!cap?.ok) {
      Alert.alert('확인', cap?.error ?? '일정 후보를 확인해 주세요.');
      return;
    }
    const existing = meeting.dateCandidates ?? [];
    const fromForm = cap.payload.dateCandidates;
    const { merged, additions } = mergeAppendNewDateCandidatesWithoutDup(existing, fromForm);

    if (additions.length === 0) {
      Alert.alert('알림', '기존 일시와 겹치는 날짜만 있어 추가된 항목이 없습니다.');
      setProposeOpen(false);
      return;
    }

    const uid = userId?.trim();
    if (uid) {
      try {
        await assertDateCandidatesNoOverlapWithOtherMeetings({
          appUserId: uid,
          candidates: additions,
          bufferHours: DATE_CANDIDATE_OVERLAP_BUFFER_HOURS,
          excludeMeetingId: meeting.id,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showTransientBottomMessage(`${GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION}\n\n${msg}`);
        return;
      }
    }

    setProposeSaving(true);
    try {
      markRecentSelfMeetingChange(meeting.id);
      await updateMeetingDateCandidates(meeting.id, merged, { priorDateCandidates: existing });
      let refreshed: Meeting | null = null;
      try {
        refreshed = await getMeetingById(meeting.id);
      } catch {
        refreshed = null;
      }
      const dates =
        refreshed?.dateCandidates != null && refreshed.dateCandidates.length > 0
          ? refreshed.dateCandidates
          : merged;
      queryClient.setQueryData<Meeting | null>(meetingDetailQueryKey(meeting.id), (prev) => {
        if (!prev) return prev;
        if (refreshed) {
          return { ...refreshed, dateCandidates: dates.map((d) => ({ ...d })) };
        }
        return { ...prev, dateCandidates: dates.map((d) => ({ ...d })) };
      });
      void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
      setSelectedDateIds(additions.map((d, j) => dateCandidateChipId(d, existing.length + j)));
      setProposeOpen(false);
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : '일정 후보를 저장하지 못했습니다.');
    } finally {
      setProposeSaving(false);
    }
  }, [meeting, queryClient, userId]);

  const confirmPlaceProposals = useCallback(async () => {
    if (!meeting) return;
    const cap = placeVoteFormRef.current?.capturePlaceCandidatesOnly();
    if (!cap?.ok) {
      Alert.alert('확인', cap?.error ?? '장소 후보를 확인해 주세요.');
      return;
    }
    const existing = (meeting.placeCandidates ?? []) as PlaceCandidate[];
    const fromForm = cap.payload.placeCandidates;
    const { merged, additions } = mergeAppendNewPlaceCandidatesWithoutDup(existing, fromForm);

    if (additions.length === 0) {
      Alert.alert('알림', '기존 장소와 겹치는 장소만 있어 추가된 항목이 없습니다.');
      setPlaceProposeOpen(false);
      return;
    }

    setPlaceProposeSaving(true);
    try {
      markRecentSelfMeetingChange(meeting.id);
      await updateMeetingPlaceCandidates(meeting.id, merged);
      let refreshed: Meeting | null = null;
      try {
        refreshed = await getMeetingById(meeting.id);
      } catch {
        refreshed = null;
      }
      const places =
        refreshed?.placeCandidates != null && refreshed.placeCandidates.length > 0
          ? refreshed.placeCandidates
          : merged;
      queryClient.setQueryData<Meeting | null>(meetingDetailQueryKey(meeting.id), (prev) => {
        if (!prev) return prev;
        if (refreshed) {
          return { ...refreshed, placeCandidates: places.map((p) => ({ ...p })) };
        }
        return { ...prev, placeCandidates: places.map((p) => ({ ...p })) };
      });
      void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
      setSelectedPlaceIds(additions.map((p, j) => String(p.id ?? '').trim() || `pc-${existing.length + j}`));
      setPlaceProposeOpen(false);
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : '장소 후보를 저장하지 못했습니다.');
    } finally {
      setPlaceProposeSaving(false);
    }
  }, [meeting, queryClient]);

  const toggleDateSelection = useCallback((chipId: string) => {
    setSelectedDateIds((prev) => (prev.includes(chipId) ? prev.filter((x) => x !== chipId) : [...prev, chipId]));
  }, []);

  const togglePlaceSelection = useCallback((chipId: string) => {
    setSelectedPlaceIds((prev) => (prev.includes(chipId) ? prev.filter((x) => x !== chipId) : [...prev, chipId]));
  }, []);

  const toggleMovieSelection = useCallback((chipId: string) => {
    setSelectedMovieIds((prev) => (prev.includes(chipId) ? prev.filter((x) => x !== chipId) : [...prev, chipId]));
  }, []);

  useEffect(() => {
    setSelectedDateIds([]);
    setSelectedPlaceIds([]);
    setSelectedMovieIds([]);
  }, [meeting?.id]);

  const guestVotesReady = useMemo(() => {
    if (meeting?.scheduleConfirmed === true) return true;
    if (needsDatePick && !autoDatePick && selectedDateIds.length === 0) return false;
    if (needsPlacePick && !autoPlacePick && selectedPlaceIds.length === 0) return false;
    if (needsMoviePick && !autoMoviePick && selectedMovieIds.length === 0) return false;
    return true;
  }, [
    meeting?.scheduleConfirmed,
    needsDatePick,
    needsPlacePick,
    needsMoviePick,
    autoDatePick,
    autoPlacePick,
    autoMoviePick,
    selectedDateIds.length,
    selectedPlaceIds.length,
    selectedMovieIds.length,
  ]);

  // 후보가 1개뿐이면 “투표”가 아니라 확정 내역처럼 고정 표시(자동 선택)합니다.
  useEffect(() => {
    if (!meeting || meeting.scheduleConfirmed === true) return;
    if (autoDatePick && dateChips[0]?.id && selectedDateIds.length === 0) {
      setSelectedDateIds([dateChips[0].id]);
    }
    if (autoPlacePick && placeChips[0]?.id && selectedPlaceIds.length === 0) {
      setSelectedPlaceIds([placeChips[0].id]);
    }
    if (autoMoviePick && extraMovies[0] && selectedMovieIds.length === 0) {
      setSelectedMovieIds([movieCandidateChipId(extraMovies[0], 0)]);
    }
  }, [
    meeting,
    autoDatePick,
    autoPlacePick,
    autoMoviePick,
    dateChips,
    placeChips,
    extraMovies,
    selectedDateIds.length,
    selectedPlaceIds.length,
    selectedMovieIds.length,
  ]);

  const votesFingerprint = useCallback(
    (ids: { date: readonly string[]; place: readonly string[]; movie: readonly string[] }) => {
      const norm = (xs: readonly string[]) => [...xs].filter(Boolean).slice().sort().join('\u0001');
      return [norm(ids.date), norm(ids.place), norm(ids.movie)].join('\u0002');
    },
    [],
  );

  const serverVoteFingerprint = useMemo(() => {
    if (!meeting || !sessionPk || isHost || !alreadyJoinedMeeting) return '';
    const snap = getParticipantVoteSnapshot(meeting, sessionPk);
    if (!snap) return 'legacy';
    return votesFingerprint({ date: snap.dateChipIds, place: snap.placeChipIds, movie: snap.movieChipIds });
  }, [meeting, sessionPk, isHost, alreadyJoinedMeeting, votesFingerprint]);

  const hostPersistedVoteFp = useMemo(() => {
    if (!meeting || !sessionPk || !isHost) return '';
    const snap = getParticipantVoteSnapshot(meeting, sessionPk);
    if (!snap) return '';
    return votesFingerprint({
      date: snap.dateChipIds,
      place: snap.placeChipIds,
      movie: snap.movieChipIds,
    });
  }, [meeting, sessionPk, isHost, votesFingerprint]);

  useEffect(() => {
    if (!meeting || !sessionPk) return;
    if (isHost) {
      if (!hostPersistedVoteFp) return;
      const snap = getParticipantVoteSnapshot(meeting, sessionPk);
      if (!snap) return;
      setSelectedDateIds([...snap.dateChipIds]);
      setSelectedPlaceIds([...snap.placeChipIds]);
      setSelectedMovieIds([...snap.movieChipIds]);
      return;
    }
    if (!alreadyJoinedMeeting) return;
    if (serverVoteFingerprint === '' || serverVoteFingerprint === 'legacy') return;
    const snap = getParticipantVoteSnapshot(meeting, sessionPk);
    if (!snap) return;
    setSelectedDateIds([...snap.dateChipIds]);
    setSelectedPlaceIds([...snap.placeChipIds]);
    setSelectedMovieIds([...snap.movieChipIds]);
  }, [meeting, sessionPk, isHost, alreadyJoinedMeeting, hostPersistedVoteFp, serverVoteFingerprint]);

  const participantVoteLogMissing = Boolean(meeting && !isHost && alreadyJoinedMeeting && sessionPk) && serverVoteFingerprint === 'legacy';

  const votesBaselineFpRef = useRef<string | null>(null);
  useEffect(() => {
    votesBaselineFpRef.current = null;
    setVotePersistNonce(0);
  }, [meeting?.id, sessionPk]);

  const effectiveDateIds = autoDatePick && dateChips[0]?.id ? [dateChips[0].id] : selectedDateIds;
  const effectivePlaceIds = autoPlacePick && placeChips[0]?.id ? [placeChips[0].id] : selectedPlaceIds;
  const effectiveMovieIds =
    autoMoviePick && extraMovies[0] ? [movieCandidateChipId(extraMovies[0], 0)] : selectedMovieIds;

  const currentVotesFp = useMemo(
    () => votesFingerprint({ date: effectiveDateIds, place: effectivePlaceIds, movie: effectiveMovieIds }),
    [effectiveDateIds, effectivePlaceIds, effectiveMovieIds, votesFingerprint],
  );

  useEffect(() => {
    if (!meeting || !sessionPk) return;
    if (!(isHost || alreadyJoinedMeeting)) return;
    if (votesBaselineFpRef.current != null) return;

    if (!isHost && alreadyJoinedMeeting && serverVoteFingerprint && serverVoteFingerprint !== 'legacy') {
      votesBaselineFpRef.current = serverVoteFingerprint;
    } else {
      const snap = getParticipantVoteSnapshot(meeting, sessionPk);
      if (snap) {
        votesBaselineFpRef.current = votesFingerprint({
          date: snap.dateChipIds,
          place: snap.placeChipIds,
          movie: snap.movieChipIds,
        });
      } else {
        votesBaselineFpRef.current = currentVotesFp;
      }
    }
    setVotePersistNonce((n) => n + 1);
  }, [meeting, sessionPk, isHost, alreadyJoinedMeeting, serverVoteFingerprint, currentVotesFp, votesFingerprint]);

  const votesDirty = useMemo(() => {
    void votePersistNonce;
    const base = votesBaselineFpRef.current;
    if (!base) return false;
    return base !== currentVotesFp;
  }, [currentVotesFp, votePersistNonce]);

  const flushVoteSelectionsToServer = useCallback(async (): Promise<boolean> => {
    if (!meeting) return false;
    if (!sessionPk) {
      Alert.alert('안내', '로그인 후 투표를 반영할 수 있어요.');
      return false;
    }
    const effectiveDateIds = autoDatePick && dateChips[0]?.id ? [dateChips[0].id] : selectedDateIds;
    const effectivePlaceIds = autoPlacePick && placeChips[0]?.id ? [placeChips[0].id] : selectedPlaceIds;
    const effectiveMovieIds = autoMoviePick && extraMovies[0] ? [movieCandidateChipId(extraMovies[0], 0)] : selectedMovieIds;

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
          ? `${parts.join(', ')}에서 최소 한 가지 이상 선택한 뒤 반영할 수 있어요.`
          : '각 투표에서 최소 한 가지 이상 선택한 뒤 반영할 수 있어요.',
        firstScrollSection != null ? [{ text: '확인', onPress: () => scrollToVoteBlock(firstScrollSection) }] : [{ text: '확인' }],
      );
      return false;
    }
    if (!isHost && !getParticipantVoteSnapshot(meeting, sessionPk)) {
      Alert.alert(
        '투표 내역을 불러올 수 없어요',
        '예전 방식으로 참여된 모임이에요. 투표를 바꾸려면 탈퇴한 뒤 다시 참여해 주세요.',
      );
      return false;
    }

    setParticipantVoteBusy(true);
    try {
      await ensureUserProfile(sessionPk);
      markRecentSelfMeetingChange(meeting.id);
      if (isHost) {
        await upsertParticipantVotes(meeting.id, sessionPk, {
          dateChipIds: effectiveDateIds,
          placeChipIds: effectivePlaceIds,
          movieChipIds: effectiveMovieIds,
        });
      } else {
        await updateParticipantVotes(meeting.id, sessionPk, {
          dateChipIds: effectiveDateIds,
          placeChipIds: effectivePlaceIds,
          movieChipIds: effectiveMovieIds,
        });
      }
      votesBaselineFpRef.current = votesFingerprint({
        date: effectiveDateIds,
        place: effectivePlaceIds,
        movie: effectiveMovieIds,
      });
      setVotePersistNonce((n) => n + 1);
      void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
      showTransientBottomMessage('투표가 저장됐어요.', 1600, 74);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (isConfirmedScheduleOverlapErrorMessage(msg)) {
        showTransientBottomMessage(`${GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION}\n\n${msg}`);
      } else {
        Alert.alert('저장 실패', msg || '다시 시도해 주세요.');
      }
      return false;
    } finally {
      setParticipantVoteBusy(false);
    }
  }, [
    meeting,
    sessionPk,
    isHost,
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
    votesFingerprint,
    queryClient,
    scrollToVoteBlock,
  ]);

  const onPressSaveVotes = useCallback(() => {
    if (participantVoteBusy) {
      Alert.alert('안내', '저장 중이에요. 잠시만 기다려 주세요.');
      return;
    }
    if (participantVoteLogMissing) {
      Alert.alert(
        '투표 내역을 불러올 수 없어요',
        '예전 방식으로 참여된 모임이에요. 투표를 바꾸려면 탈퇴한 뒤 다시 참여해 주세요.',
      );
      return;
    }
    if (!votesDirty) {
      showTransientBottomMessage('변경된 투표가 없어요.', 1400, 74);
      return;
    }
    void flushVoteSelectionsToServer();
  }, [flushVoteSelectionsToServer, participantVoteBusy, participantVoteLogMissing, votesDirty]);

  // join/요청 플로우는 Step2 useMeetingJoin로 이동 예정이지만,
  // vote 훅이 가진 파생값을 그대로 쓰는 함수들의 시그니처를 유지하기 위해 여기서 계산만 제공.
  const voteJoinGuards = useMemo(() => {
    const effectiveDateIds = autoDatePick && dateChips[0]?.id ? [dateChips[0].id] : selectedDateIds;
    const effectivePlaceIds = autoPlacePick && placeChips[0]?.id ? [placeChips[0].id] : selectedPlaceIds;
    const effectiveMovieIds = autoMoviePick && extraMovies[0] ? [movieCandidateChipId(extraMovies[0], 0)] : selectedMovieIds;
    return { effectiveDateIds, effectivePlaceIds, effectiveMovieIds };
  }, [autoDatePick, autoPlacePick, autoMoviePick, dateChips, placeChips, extraMovies, selectedDateIds, selectedPlaceIds, selectedMovieIds]);

  return {
    // selections
    selectedDateIds,
    setSelectedDateIds,
    selectedPlaceIds,
    setSelectedPlaceIds,
    selectedMovieIds,
    setSelectedMovieIds,
    toggleDateSelection,
    togglePlaceSelection,
    toggleMovieSelection,

    // calendar
    dateVoteCalendarMonth,
    setDateVoteCalendarMonth,
    dateVoteCalendarPagerW,
    setDateVoteCalendarPagerW,
    dateVoteCalendarPagerRef,
    dateVoteCalendarPagerIgnoreMomentumEndRef,
    dateVoteCalendarCenterOpacity,
    dateVoteCalendarSwipeFadeAfterRecenterRef,
    dateVoteCalendarFadeAnimRef,
    dateVoteCalendarYmPick,
    setDateVoteCalendarYmPick,
    dateVoteTimePick,
    setDateVoteTimePick,

    // propose
    proposeOpen,
    setProposeOpen,
    proposeFormKey,
    setProposeFormKey,
    proposeSaving,
    setProposeSaving,
    voteFormRef,
    proposeInitialPayload,
    openDateProposeModal,
    confirmDateProposals,

    placeProposeOpen,
    setPlaceProposeOpen,
    placeProposeFormKey,
    setPlaceProposeFormKey,
    placeProposeSaving,
    setPlaceProposeSaving,
    placeVoteFormRef,
    placeProposeInitialPayload,
    openPlaceProposeModal,
    confirmPlaceProposals,

    // scroll
    voteSectionScrollYs,
    scrollToVoteBlock,

    // persist
    participantVoteBusy,
    votePersistNonce,
    setVotePersistNonce,
    votesDirty,
    flushVoteSelectionsToServer,
    onPressSaveVotes,
    participantVoteLogMissing,
    guestVotesReady,
    voteJoinGuards,
  };
}

