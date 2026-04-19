import { VoteCandidatesForm, type VoteCandidatesFormHandle } from '@/app/create/details';
import { CAPACITY_UNLIMITED } from '@/components/create/GlassDualCapacityWheel';
import { GooglePlacePreviewMap } from '@/components/GooglePlacePreviewMap';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { resolveSpecialtyKind, type SpecialtyKind } from '@/src/lib/category-specialty';
import { createPointCandidate, fmtDateYmd, normalizeTimeInput } from '@/src/lib/date-candidate';
import type { MeetingExtraData, SelectedMovieExtra, SportIntensityLevel } from '@/src/lib/meeting-extra-data';
import type { DateCandidate, PlaceCandidate, VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import type { Meeting } from '@/src/lib/meetings';
import {
  computeMeetingConfirmAnalysis,
  confirmMeetingSchedule,
  deleteMeetingByHost,
  getMeetingById,
  getMeetingRecruitmentPhase,
  getParticipantVoteSnapshot,
  joinMeeting,
  leaveMeeting,
  resolveVoteTopTies,
  subscribeMeetingById,
  unconfirmMeetingSchedule,
  updateMeetingDateCandidates,
  updateMeetingPlaceCandidates,
  updateParticipantVotes,
} from '@/src/lib/meetings';
import { openNaverMapAt } from '@/src/lib/open-naver-map';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { ensureUserProfile, getUserProfilesForIds } from '@/src/lib/user-profile';

const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 칩 한 줄 — 날짜 + (선택) 시간 (`startDate` 누락·레거시 문서 대비) */
function formatDateCandidateTitle(dc: DateCandidate): string {
  const raw = typeof dc.startDate === 'string' ? dc.startDate.trim() : '';
  if (!raw) {
    return dc.textLabel?.trim() || '일정 후보';
  }
  const parts = raw.split('-').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return dc.textLabel?.trim() || raw;
  }
  const [y, mo, d] = parts;
  const date = new Date(y, mo - 1, d);
  const w = WEEK_KO[date.getDay()] ?? '';
  return `${mo}월 ${d}일 (${w})`;
}

type DateChip = { id: string; title: string; sub?: string };

/** 투표 칩·선택 상태와 동일한 id (후보에 id 없을 때 인덱스 fallback) */
function dateCandidateChipId(d: DateCandidate, index: number): string {
  return d.id?.trim() || `dc-${index}`;
}

function buildDateChipsFromCandidates(list: DateCandidate[]): DateChip[] {
  if (list.length > 0) {
    return list.map((dc, i) => ({
      id: dateCandidateChipId(dc, i),
      title: formatDateCandidateTitle(dc),
      sub: dc.startTime?.trim() ? normalizeTimeInput(dc.startTime) : undefined,
    }));
  }
  return [
    { id: 'mock-1', title: '4월 16일 (목)', sub: '14:00' },
    { id: 'mock-2', title: '4월 17일 (금)', sub: '14:00' },
  ];
}

type PlaceChip = { id: string; title: string; sub?: string };

function getExtraDataSpecialtyKind(meeting: Meeting): SpecialtyKind | null {
  const raw = meeting.extraData;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const k = (raw as { specialtyKind?: unknown }).specialtyKind;
    if (k === 'movie' || k === 'food' || k === 'sports') return k;
  }
  const label = meeting.categoryLabel?.trim() ?? '';
  return label ? resolveSpecialtyKind(label) : null;
}

function sportIntensityKo(level: SportIntensityLevel | null | undefined): string {
  switch (level) {
    case 'easy':
      return '가볍게';
    case 'hard':
      return '강하게';
    case 'normal':
    default:
      return '보통';
  }
}

function formatCapacityLine(m: Meeting): string {
  const max = m.capacity;
  const min = m.minParticipants ?? null;
  const maxUnlimited = max === CAPACITY_UNLIMITED;
  const maxPart = maxUnlimited ? '무제한' : `최대 ${max}명`;
  if (min != null && min > 0 && !maxUnlimited && min !== max) {
    return `${min}명 ~ ${maxPart}`;
  }
  return maxPart;
}

function extractMoviesFromExtra(extra: Meeting['extraData']): SelectedMovieExtra[] {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return [];
  const e = extra as MeetingExtraData;
  if (Array.isArray(e.movies) && e.movies.length > 0) {
    return e.movies.filter((x): x is SelectedMovieExtra => x != null && String(x.title ?? '').trim() !== '');
  }
  if (e.movie && typeof e.movie === 'object' && String(e.movie.title ?? '').trim() !== '') {
    return [e.movie];
  }
  return [];
}

function extractMenuPreferences(extra: Meeting['extraData']): string[] {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return [];
  const prefs = (extra as MeetingExtraData).menuPreferences;
  if (!Array.isArray(prefs)) return [];
  return prefs.map((s) => String(s).trim()).filter(Boolean);
}

function extractSportIntensity(extra: Meeting['extraData']): SportIntensityLevel | null {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const v = (extra as MeetingExtraData).sportIntensity;
  if (v === 'easy' || v === 'normal' || v === 'hard') return v;
  return null;
}

function placeCandidateChipId(p: { id?: string }, index: number): string {
  const pid = typeof p.id === 'string' ? p.id.trim() : '';
  return pid || `pc-${index}`;
}

/** 동일 id 중복·빈 id 대비: 목록 인덱스를 포함해 투표 칩 id를 고정합니다. */
function movieCandidateChipId(mv: SelectedMovieExtra, index: number): string {
  const mid = String(mv.id ?? '').trim();
  if (mid) return `${mid}#${index}`;
  return `movie-${index}`;
}

function buildPlaceChipsFromMeeting(m: Meeting): PlaceChip[] {
  const list = m.placeCandidates ?? [];
  if (list.length > 0) {
    return list.map((p, i) => ({
      id: placeCandidateChipId(p, i),
      title: p.placeName?.trim() || '장소',
      sub: p.address?.trim() || undefined,
    }));
  }
  const name = m.placeName?.trim() || m.location?.trim();
  const addr = m.address?.trim();
  if (name || addr) {
    return [{ id: 'legacy-place', title: name || '장소', sub: addr || undefined }];
  }
  return [];
}

function formatTopScheduleLine(m: Meeting): string | null {
  const d = m.scheduleDate?.trim();
  const t = m.scheduleTime?.trim();
  if (!d && !t) return null;
  const timeDisp = t ? normalizeTimeInput(t) || t : '';
  if (d && timeDisp) return `대표 일정: ${d} · ${timeDisp}`;
  if (d) return `대표 일정: ${d}`;
  return `대표 시간: ${timeDisp}`;
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

function normalizeParticipantId(raw: string): string {
  return normalizePhoneUserId(raw) ?? raw.trim();
}

/** 표시 순서: 주선자 → 나머지 참여자(중복 제거) */
function orderedParticipantIds(m: Meeting): string[] {
  const hostRaw = m.createdBy?.trim() ?? '';
  const host = hostRaw ? normalizeParticipantId(hostRaw) : '';
  const listRaw = m.participantIds ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  if (host) {
    seen.add(host);
    out.push(host);
  }
  for (const x of listRaw) {
    const id = normalizeParticipantId(String(x));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function nicknameInitial(nickname: string): string {
  const t = nickname.trim();
  if (!t) return '?';
  const g = Array.from(t)[0];
  return g ?? '?';
}

/** 세션 전화 PK와 모임 `createdBy`(정규화된 전화 PK)가 같으면 주선자 */
function isMeetingHost(sessionPhone: string | null, createdBy: string | null | undefined): boolean {
  const s = sessionPhone?.trim() ?? '';
  const c = createdBy?.trim() ?? '';
  if (!s || !c) return false;
  if (s === c) return true;
  const ns = normalizePhoneUserId(s) ?? s;
  const nc = normalizePhoneUserId(c) ?? c;
  return ns === nc;
}

export default function MeetingDetailScreen() {
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { phoneUserId } = useUserSession();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 일시 투표 — 후보 id 다중 선택 (로컬 UI, 추후 서버 반영) */
  const [selectedDateIds, setSelectedDateIds] = useState<string[]>([]);
  /** 장소 투표 — 후보 id 다중 선택 (로컬 UI, 추후 서버 반영) */
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<string[]>([]);
  /** 영화 투표 — 후보 id 다중 선택 (로컬 UI, 추후 서버 반영) */
  const [selectedMovieIds, setSelectedMovieIds] = useState<string[]>([]);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeFormKey, setProposeFormKey] = useState(0);
  const [proposeSaving, setProposeSaving] = useState(false);
  const voteFormRef = useRef<VoteCandidatesFormHandle>(null);
  const mainScrollRef = useRef<ScrollView>(null);
  const voteSectionScrollYs = useRef({ date: 0, movie: 0, place: 0 });

  const [placeProposeOpen, setPlaceProposeOpen] = useState(false);
  const [placeProposeFormKey, setPlaceProposeFormKey] = useState(0);
  const [placeProposeSaving, setPlaceProposeSaving] = useState(false);
  const placeVoteFormRef = useRef<VoteCandidatesFormHandle>(null);

  const [retryNonce, setRetryNonce] = useState(0);
  const [participantProfiles, setParticipantProfiles] = useState<
    Record<string, { nickname: string; photoUrl: string | null }>
  >({});
  const [joinBusy, setJoinBusy] = useState(false);
  const [participantVoteBusy, setParticipantVoteBusy] = useState(false);
  const [confirmScheduleBusy, setConfirmScheduleBusy] = useState(false);
  const [deleteMeetingBusy, setDeleteMeetingBusy] = useState(false);
  const [hostTieDateId, setHostTieDateId] = useState<string | null>(null);
  const [hostTiePlaceId, setHostTiePlaceId] = useState<string | null>(null);
  const [hostTieMovieId, setHostTieMovieId] = useState<string | null>(null);

  useEffect(() => {
    if (!id.trim()) {
      setMeeting(null);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    let alive = true;
    const unsub = subscribeMeetingById(
      id,
      (m) => {
        if (!alive) return;
        setMeeting(m);
        setLoading(false);
        setLoadError(null);
      },
      (msg) => {
        if (!alive) return;
        setLoadError(msg);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
      unsub();
    };
  }, [id, retryNonce]);

  useEffect(() => {
    if (!meeting) {
      setParticipantProfiles({});
      return;
    }
    const ids = orderedParticipantIds(meeting);
    if (ids.length === 0) {
      setParticipantProfiles({});
      return;
    }
    let cancelled = false;
    void getUserProfilesForIds(ids).then((map) => {
      if (cancelled) return;
      const rec: Record<string, { nickname: string; photoUrl: string | null }> = {};
      map.forEach((v, k) => {
        rec[k] = v;
      });
      setParticipantProfiles(rec);
    });
    return () => {
      cancelled = true;
    };
  }, [meeting]);

  useEffect(() => {
    setSelectedDateIds([]);
    setSelectedPlaceIds([]);
    setSelectedMovieIds([]);
    setHostTieDateId(null);
    setHostTiePlaceId(null);
    setHostTieMovieId(null);
  }, [meeting?.id]);

  const storedDateCandidates = meeting?.dateCandidates ?? [];
  const dateChips = useMemo(() => {
    if (!meeting) return [];
    const list = meeting.dateCandidates ?? [];
    return buildDateChipsFromCandidates(list);
  }, [meeting]);

  const placeChips = useMemo(() => (meeting ? buildPlaceChipsFromMeeting(meeting) : []), [meeting]);

  const sortedDateChips = useMemo(() => {
    const t = meeting?.voteTallies?.dates ?? {};
    return dateChips
      .map((chip, idx) => ({ chip, idx }))
      .sort((a, b) => {
        const ca = t[a.chip.id] ?? 0;
        const cb = t[b.chip.id] ?? 0;
        if (cb !== ca) return cb - ca;
        return a.idx - b.idx;
      })
      .map((x) => x.chip);
  }, [meeting?.voteTallies?.dates, dateChips]);

  const sortedPlaceChips = useMemo(() => {
    const t = meeting?.voteTallies?.places ?? {};
    return placeChips
      .map((chip, idx) => ({ chip, idx }))
      .sort((a, b) => {
        const ca = t[a.chip.id] ?? 0;
        const cb = t[b.chip.id] ?? 0;
        if (cb !== ca) return cb - ca;
        return a.idx - b.idx;
      })
      .map((x) => x.chip);
  }, [meeting?.voteTallies?.places, placeChips]);

  const specialtyKind = useMemo(() => (meeting ? getExtraDataSpecialtyKind(meeting) : null), [meeting]);
  const extraMovies = useMemo(() => (meeting ? extractMoviesFromExtra(meeting.extraData) : []), [meeting?.extraData]);

  const sortedMovieVoteRows = useMemo(() => {
    const t = meeting?.voteTallies?.movies ?? {};
    const rows = extraMovies.map((mv, mi) => ({
      mv,
      mi,
      chipId: movieCandidateChipId(mv, mi),
    }));
    return [...rows].sort((a, b) => {
      const ca = t[a.chipId] ?? 0;
      const cb = t[b.chipId] ?? 0;
      if (cb !== ca) return cb - ca;
      return a.mi - b.mi;
    });
  }, [meeting?.voteTallies?.movies, extraMovies]);

  const isScheduleConfirmed = meeting?.scheduleConfirmed === true;

  const confirmedDateChipResolved = useMemo(() => {
    if (!isScheduleConfirmed || !meeting?.confirmedDateChipId?.trim()) return null;
    const id = meeting.confirmedDateChipId.trim();
    return dateChips.find((c) => c.id === id) ?? null;
  }, [isScheduleConfirmed, meeting?.confirmedDateChipId, dateChips]);

  const confirmedPlaceChipResolved = useMemo(() => {
    if (!isScheduleConfirmed || !meeting?.confirmedPlaceChipId?.trim()) return null;
    const id = meeting.confirmedPlaceChipId.trim();
    return placeChips.find((c) => c.id === id) ?? null;
  }, [isScheduleConfirmed, meeting?.confirmedPlaceChipId, placeChips]);

  const confirmedPlaceCoords = useMemo(() => {
    if (!isScheduleConfirmed || !meeting?.confirmedPlaceChipId?.trim()) return null;
    const rawId = meeting.confirmedPlaceChipId.trim();
    const cands = meeting.placeCandidates ?? [];
    for (let i = 0; i < cands.length; i++) {
      if (placeCandidateChipId(cands[i], i) === rawId) {
        const lat = cands[i].latitude;
        const lng = cands[i].longitude;
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { latitude: lat, longitude: lng };
        return null;
      }
    }
    if (rawId === 'legacy-place') {
      const lat = meeting.latitude;
      const lng = meeting.longitude;
      if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng };
      }
    }
    return null;
  }, [
    isScheduleConfirmed,
    meeting?.confirmedPlaceChipId,
    meeting?.placeCandidates,
    meeting?.latitude,
    meeting?.longitude,
  ]);

  const confirmedMovieResolved = useMemo(() => {
    if (!isScheduleConfirmed || !meeting?.confirmedMovieChipId?.trim()) return null;
    const id = meeting.confirmedMovieChipId.trim();
    for (let mi = 0; mi < extraMovies.length; mi++) {
      if (movieCandidateChipId(extraMovies[mi], mi) === id) return extraMovies[mi];
    }
    return null;
  }, [isScheduleConfirmed, meeting?.confirmedMovieChipId, extraMovies]);

  const extraMenus = useMemo(() => (meeting ? extractMenuPreferences(meeting.extraData) : []), [meeting?.extraData]);
  const extraSport = useMemo(() => (meeting ? extractSportIntensity(meeting.extraData) : null), [meeting?.extraData]);

  const representativeScheduleText = useMemo(() => {
    if (!meeting) return null;
    if (meeting.scheduleConfirmed === true) return null;
    return formatTopScheduleLine(meeting);
  }, [meeting]);

  /** 날짜 제안 모달 — 기존 후보 목록 없이 새 행만: 기본값은 모임 상단 일정 또는 오늘 */
  const insertModalSchedule = useMemo(() => {
    const sd = meeting?.scheduleDate?.trim();
    const st = meeting?.scheduleTime?.trim();
    if (sd && st) return { scheduleDate: sd, scheduleTime: st };
    return { scheduleDate: fmtDateYmd(new Date()), scheduleTime: '15:00' };
  }, [meeting?.scheduleDate, meeting?.scheduleTime]);

  const proposeInitialPayload = useMemo((): VoteCandidatesPayload | null => {
    if (!meeting || !proposeOpen) return null;
    const dates = [
      createPointCandidate(
        newDateCandidateId(),
        insertModalSchedule.scheduleDate,
        insertModalSchedule.scheduleTime,
      ),
    ];
    const places = meeting.placeCandidates?.length ? meeting.placeCandidates.map((p) => ({ ...p })) : [];
    return { dateCandidates: dates, placeCandidates: places };
  }, [meeting, insertModalSchedule, proposeOpen, proposeFormKey]);

  /** 장소 제안 모달 — 빈 행으로 시작(내부적으로만 기본 일시 시드 사용) */
  const placeProposeInitialPayload = useMemo((): VoteCandidatesPayload | null => {
    if (!meeting || !placeProposeOpen) return null;
    return { dateCandidates: [], placeCandidates: [] };
  }, [meeting, placeProposeOpen, placeProposeFormKey]);

  const openDateProposeModal = useCallback(() => {
    setProposeFormKey((k) => k + 1);
    setProposeOpen(true);
  }, []);

  const openPlaceProposeModal = useCallback(() => {
    setPlaceProposeFormKey((k) => k + 1);
    setPlaceProposeOpen(true);
  }, []);

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

    setProposeSaving(true);
    try {
      await updateMeetingDateCandidates(meeting.id, merged);
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
      setMeeting((prev) => {
        if (!prev) return prev;
        if (refreshed) {
          return { ...refreshed, dateCandidates: dates.map((d) => ({ ...d })) };
        }
        return { ...prev, dateCandidates: dates.map((d) => ({ ...d })) };
      });
      setSelectedDateIds(additions.map((d, j) => dateCandidateChipId(d, existing.length + j)));
      setProposeOpen(false);
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : '일정 후보를 저장하지 못했습니다.');
    } finally {
      setProposeSaving(false);
    }
  }, [meeting]);

  const confirmPlaceProposals = useCallback(async () => {
    if (!meeting) return;
    const cap = placeVoteFormRef.current?.capturePlaceCandidatesOnly();
    if (!cap?.ok) {
      Alert.alert('확인', cap?.error ?? '장소 후보를 확인해 주세요.');
      return;
    }
    const existing = meeting.placeCandidates ?? [];
    const fromForm = cap.payload.placeCandidates;
    const { merged, additions } = mergeAppendNewPlaceCandidatesWithoutDup(existing, fromForm);

    if (additions.length === 0) {
      Alert.alert('알림', '기존 장소와 겹치는 장소만 있어 추가된 항목이 없습니다.');
      setPlaceProposeOpen(false);
      return;
    }

    setPlaceProposeSaving(true);
    try {
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
      setMeeting((prev) => {
        if (!prev) return prev;
        if (refreshed) {
          return { ...refreshed, placeCandidates: places.map((p) => ({ ...p })) };
        }
        return { ...prev, placeCandidates: places.map((p) => ({ ...p })) };
      });
      setSelectedPlaceIds(additions.map((p, j) => placeCandidateChipId(p, existing.length + j)));
      setPlaceProposeOpen(false);
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : '장소 후보를 저장하지 못했습니다.');
    } finally {
      setPlaceProposeSaving(false);
    }
  }, [meeting]);

  const toggleDateSelection = useCallback((chipId: string) => {
    setSelectedDateIds((prev) =>
      prev.includes(chipId) ? prev.filter((x) => x !== chipId) : [...prev, chipId],
    );
  }, []);

  const togglePlaceSelection = useCallback((chipId: string) => {
    setSelectedPlaceIds((prev) =>
      prev.includes(chipId) ? prev.filter((x) => x !== chipId) : [...prev, chipId],
    );
  }, []);

  const toggleMovieSelection = useCallback((chipId: string) => {
    setSelectedMovieIds((prev) =>
      prev.includes(chipId) ? prev.filter((x) => x !== chipId) : [...prev, chipId],
    );
  }, []);

  const isHost = useMemo(() => (meeting ? isMeetingHost(phoneUserId, meeting.createdBy) : false), [meeting, phoneUserId]);

  const orderedParticipantIdsList = useMemo(() => (meeting ? orderedParticipantIds(meeting) : []), [meeting]);

  const sessionPk = useMemo(
    () => (phoneUserId?.trim() ? normalizePhoneUserId(phoneUserId) ?? phoneUserId.trim() : ''),
    [phoneUserId],
  );

  const alreadyJoinedMeeting = useMemo(() => {
    if (!sessionPk) return false;
    return orderedParticipantIdsList.includes(sessionPk);
  }, [sessionPk, orderedParticipantIdsList]);

  /** 게스트 참여 조건: 화면에 있는 각 투표 구역마다 최소 1개 선택 */
  const needsDatePick = dateChips.length > 0;
  const needsPlacePick = placeChips.length > 0;
  const needsMoviePick =
    (specialtyKind === 'movie' || extraMovies.length > 0) && extraMovies.length > 0;

  const guestVotesReady = useMemo(() => {
    if (meeting?.scheduleConfirmed === true) return true;
    if (needsDatePick && selectedDateIds.length === 0) return false;
    if (needsPlacePick && selectedPlaceIds.length === 0) return false;
    if (needsMoviePick && selectedMovieIds.length === 0) return false;
    return true;
  }, [
    meeting?.scheduleConfirmed,
    needsDatePick,
    needsPlacePick,
    needsMoviePick,
    selectedDateIds.length,
    selectedPlaceIds.length,
    selectedMovieIds.length,
  ]);

  const isParticipantGuest = Boolean(meeting && !isHost && alreadyJoinedMeeting && sessionPk);

  const serverVoteFingerprint = useMemo(() => {
    if (!meeting || !sessionPk || isHost || !alreadyJoinedMeeting) return '';
    const snap = getParticipantVoteSnapshot(meeting, sessionPk);
    if (!snap) return 'legacy';
    const norm = (ids: string[]) => [...ids].sort().join('\u0001');
    return [norm(snap.dateChipIds), norm(snap.placeChipIds), norm(snap.movieChipIds)].join('\u0002');
  }, [meeting, sessionPk, isHost, alreadyJoinedMeeting]);

  useEffect(() => {
    if (!meeting || !sessionPk || isHost || !alreadyJoinedMeeting) return;
    if (serverVoteFingerprint === '' || serverVoteFingerprint === 'legacy') return;
    const snap = getParticipantVoteSnapshot(meeting, sessionPk);
    if (!snap) return;
    setSelectedDateIds([...snap.dateChipIds]);
    setSelectedPlaceIds([...snap.placeChipIds]);
    setSelectedMovieIds([...snap.movieChipIds]);
  }, [meeting?.id, serverVoteFingerprint, sessionPk, isHost, alreadyJoinedMeeting, meeting]);

  const participantVoteLogMissing = isParticipantGuest && serverVoteFingerprint === 'legacy';
  const participantSaveDisabled =
    participantVoteBusy || !guestVotesReady || participantVoteLogMissing;

  const hostTiePicks = useMemo(
    () => ({ dateChipId: hostTieDateId, placeChipId: hostTiePlaceId, movieChipId: hostTieMovieId }),
    [hostTieDateId, hostTiePlaceId, hostTieMovieId],
  );

  const confirmAnalysis = useMemo(
    () => (meeting ? computeMeetingConfirmAnalysis(meeting, hostTiePicks) : null),
    [meeting, hostTiePicks],
  );

  /** 화면에 그린 칩 id 기준 집계 동점(서버 분석과 불일치 시에도 UI 단일 선택 보장) */
  const dateTallyTopIds = useMemo(
    () => resolveVoteTopTies(sortedDateChips.map((c) => c.id), meeting?.voteTallies?.dates).topIds,
    [sortedDateChips, meeting?.voteTallies?.dates],
  );
  const placeTallyTopIds = useMemo(
    () => resolveVoteTopTies(sortedPlaceChips.map((c) => c.id), meeting?.voteTallies?.places).topIds,
    [sortedPlaceChips, meeting?.voteTallies?.places],
  );
  const movieTallyTopIds = useMemo(
    () => resolveVoteTopTies(sortedMovieVoteRows.map((r) => r.chipId), meeting?.voteTallies?.movies).topIds,
    [sortedMovieVoteRows, meeting?.voteTallies?.movies],
  );

  const dateHostPickMode = Boolean(isHost && dateTallyTopIds.length > 1);
  const placeHostPickMode = Boolean(isHost && placeTallyTopIds.length > 1);
  const movieHostPickMode = Boolean(isHost && movieTallyTopIds.length > 1);

  const dateChipsShown = useMemo(() => {
    if (!dateHostPickMode) return sortedDateChips;
    return sortedDateChips.filter((c) => dateTallyTopIds.includes(c.id));
  }, [dateHostPickMode, dateTallyTopIds, sortedDateChips]);

  const placeChipsShown = useMemo(() => {
    if (!placeHostPickMode) return sortedPlaceChips;
    return sortedPlaceChips.filter((c) => placeTallyTopIds.includes(c.id));
  }, [placeHostPickMode, placeTallyTopIds, sortedPlaceChips]);

  const movieRowsShown = useMemo(() => {
    if (!movieHostPickMode) return sortedMovieVoteRows;
    return sortedMovieVoteRows.filter((r) => movieTallyTopIds.includes(r.chipId));
  }, [movieHostPickMode, movieTallyTopIds, sortedMovieVoteRows]);

  const handleJoinMeeting = useCallback(async () => {
    if (!meeting) return;
    if (!sessionPk) {
      Alert.alert('안내', '로그인 후 참여할 수 있어요.');
      return;
    }
    if (!guestVotesReady) {
      const parts: string[] = [];
      if (needsDatePick && selectedDateIds.length === 0) parts.push('일시');
      if (needsPlacePick && selectedPlaceIds.length === 0) parts.push('장소');
      if (needsMoviePick && selectedMovieIds.length === 0) parts.push('영화');
      Alert.alert(
        '투표를 완료해 주세요',
        parts.length > 0
          ? `${parts.join(', ')}에서 최소 한 가지 이상 선택한 뒤 참여할 수 있어요.`
          : '각 투표에서 최소 한 가지 이상 선택한 뒤 참여할 수 있어요.',
      );
      return;
    }
    setJoinBusy(true);
    try {
      await ensureUserProfile(sessionPk);
      const joinVotes =
        meeting.scheduleConfirmed === true
          ? { dateChipIds: [] as string[], placeChipIds: [] as string[], movieChipIds: [] as string[] }
          : {
              dateChipIds: selectedDateIds,
              placeChipIds: selectedPlaceIds,
              movieChipIds: selectedMovieIds,
            };
      await joinMeeting(meeting.id, sessionPk, joinVotes);
      router.replace('/(tabs)');
    } catch (e) {
      Alert.alert('참여 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setJoinBusy(false);
    }
  }, [
    router,
    meeting,
    sessionPk,
    guestVotesReady,
    meeting?.scheduleConfirmed,
    needsDatePick,
    needsPlacePick,
    needsMoviePick,
    selectedDateIds,
    selectedPlaceIds,
    selectedMovieIds,
  ]);

  const handleSaveParticipantVotes = useCallback(async () => {
    if (!meeting) return;
    if (!sessionPk) {
      Alert.alert('안내', '로그인 후 수정할 수 있어요.');
      return;
    }
    if (!guestVotesReady) {
      const parts: string[] = [];
      if (needsDatePick && selectedDateIds.length === 0) parts.push('일시');
      if (needsPlacePick && selectedPlaceIds.length === 0) parts.push('장소');
      if (needsMoviePick && selectedMovieIds.length === 0) parts.push('영화');
      Alert.alert(
        '투표를 완료해 주세요',
        parts.length > 0
          ? `${parts.join(', ')}에서 최소 한 가지 이상 선택한 뒤 저장할 수 있어요.`
          : '각 투표에서 최소 한 가지 이상 선택한 뒤 저장할 수 있어요.',
      );
      return;
    }
    if (!getParticipantVoteSnapshot(meeting, sessionPk)) {
      Alert.alert(
        '투표 내역을 불러올 수 없어요',
        '예전 방식으로 참여된 모임이에요. 투표를 바꾸려면 탈퇴한 뒤 다시 참여해 주세요.',
      );
      return;
    }
    setParticipantVoteBusy(true);
    try {
      await ensureUserProfile(sessionPk);
      await updateParticipantVotes(meeting.id, sessionPk, {
        dateChipIds: selectedDateIds,
        placeChipIds: selectedPlaceIds,
        movieChipIds: selectedMovieIds,
      });
      Alert.alert('저장됨', '투표가 반영되었어요.');
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setParticipantVoteBusy(false);
    }
  }, [
    meeting,
    sessionPk,
    guestVotesReady,
    needsDatePick,
    needsPlacePick,
    needsMoviePick,
    selectedDateIds,
    selectedPlaceIds,
    selectedMovieIds,
  ]);

  const handleLeaveParticipant = useCallback(() => {
    if (!meeting || !sessionPk) {
      Alert.alert('안내', '로그인 후 탈퇴할 수 있어요.');
      return;
    }
    Alert.alert(
      '모임에서 나가기',
      '참여를 취소하면 내가 넣었던 투표는 집계에서 빠져요. 다시 들어오려면 참여 절차가 필요해요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '나가기',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setParticipantVoteBusy(true);
              try {
                await leaveMeeting(meeting.id, sessionPk);
                router.replace('/(tabs)');
              } catch (e) {
                Alert.alert('탈퇴 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
              } finally {
                setParticipantVoteBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [meeting, sessionPk, router]);

  const recruitmentPhase = useMemo(
    () => (meeting ? getMeetingRecruitmentPhase(meeting) : null),
    [meeting],
  );

  const recruitmentBadge = useMemo(() => {
    if (!recruitmentPhase) return null;
    switch (recruitmentPhase) {
      case 'confirmed':
        return { label: '확정', wrap: styles.statusBadgeBlack, text: styles.statusBadgeTextLight };
      case 'full':
        return { label: '모집 완료', wrap: styles.statusBadgeYellow, text: styles.statusBadgeTextOnYellow };
      default:
        return { label: '모집중', wrap: styles.statusBadgeGreen, text: styles.statusBadgeTextLight };
    }
  }, [recruitmentPhase]);

  const scrollToVoteBlock = useCallback((section: 'date' | 'movie' | 'place') => {
    const y = voteSectionScrollYs.current[section];
    mainScrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, []);

  const onDateChipPress = useCallback(
    (chipId: string) => {
      if (!meeting) {
        toggleDateSelection(chipId);
        return;
      }
      const tops = resolveVoteTopTies(sortedDateChips.map((c) => c.id), meeting.voteTallies?.dates).topIds;
      if (isHost && tops.length > 1 && tops.includes(chipId)) {
        setHostTieDateId(chipId);
        return;
      }
      toggleDateSelection(chipId);
    },
    [meeting, isHost, sortedDateChips, toggleDateSelection],
  );

  const onPlaceChipPress = useCallback(
    (chipId: string) => {
      if (!meeting) {
        togglePlaceSelection(chipId);
        return;
      }
      const tops = resolveVoteTopTies(sortedPlaceChips.map((c) => c.id), meeting.voteTallies?.places).topIds;
      if (isHost && tops.length > 1 && tops.includes(chipId)) {
        setHostTiePlaceId(chipId);
        return;
      }
      togglePlaceSelection(chipId);
    },
    [meeting, isHost, sortedPlaceChips, togglePlaceSelection],
  );

  const onMovieChipPress = useCallback(
    (chipId: string) => {
      if (!meeting) {
        toggleMovieSelection(chipId);
        return;
      }
      const tops = resolveVoteTopTies(
        sortedMovieVoteRows.map((r) => r.chipId),
        meeting.voteTallies?.movies,
      ).topIds;
      if (isHost && tops.length > 1 && tops.includes(chipId)) {
        setHostTieMovieId(chipId);
        return;
      }
      toggleMovieSelection(chipId);
    },
    [meeting, isHost, sortedMovieVoteRows, toggleMovieSelection],
  );

  const handleUnconfirmMeetingSchedule = useCallback(() => {
    if (!meeting || !phoneUserId?.trim()) {
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
                await unconfirmMeetingSchedule(meeting.id, phoneUserId.trim());
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
  }, [meeting, phoneUserId]);

  const handleConfirmSchedule = useCallback(() => {
    if (!meeting || !phoneUserId?.trim()) {
      Alert.alert('안내', '로그인한 주관자만 확정할 수 있어요.');
      return;
    }
    if (meeting.scheduleConfirmed === true) return;
    const analysis = computeMeetingConfirmAnalysis(meeting, hostTiePicks);
    if (!analysis.allReady && analysis.firstBlock) {
      const { section, message } = analysis.firstBlock;
      Alert.alert('동점 후보 선택 필요', message, [
        { text: '확인', onPress: () => scrollToVoteBlock(section) },
      ]);
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
                await confirmMeetingSchedule(meeting.id, phoneUserId.trim(), hostTiePicks);
              } catch (e) {
                Alert.alert('확정 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
              } finally {
                setConfirmScheduleBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [meeting, phoneUserId, hostTiePicks, scrollToVoteBlock]);

  const handleDeleteMeeting = useCallback(() => {
    if (!meeting || !phoneUserId?.trim()) {
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
                await deleteMeetingByHost(meeting.id, phoneUserId.trim());
                router.back();
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
  }, [meeting, phoneUserId, router]);

  const onOpenConfirmedPlaceInNaverMap = useCallback(() => {
    if (!meeting || !confirmedPlaceCoords) return;
    const name =
      confirmedPlaceChipResolved?.title?.trim() ||
      meeting.placeName?.trim() ||
      meeting.location?.trim();
    void openNaverMapAt(confirmedPlaceCoords.latitude, confirmedPlaceCoords.longitude, name).then((ok) => {
      if (!ok) Alert.alert('안내', '네이버 지도를 열 수 없어요.');
    });
  }, [meeting, confirmedPlaceCoords, confirmedPlaceChipResolved?.title]);

  const notFound = !loading && !loadError && meeting === null;

  return (
    <LinearGradient colors={['#E8F2FF', '#FFF5EB']} style={styles.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="뒤로">
            <Ionicons name="chevron-back" size={26} color="#1A1A1A" />
          </Pressable>
          <Text style={styles.topTitle}>모임 상세</Text>
          {recruitmentBadge ? (
            <View style={[styles.statusBadge, recruitmentBadge.wrap]}>
              <Text style={[styles.statusBadgeText, recruitmentBadge.text]}>{recruitmentBadge.label}</Text>
            </View>
          ) : (
            <View style={styles.statusBadgePlaceholder} />
          )}
        </View>

        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={GinitTheme.trustBlue} />
            <Text style={styles.muted}>불러오는 중…</Text>
          </View>
        ) : null}

        {loadError ? (
          <View style={styles.centerFill}>
            <Text style={styles.errorTitle}>문제가 생겼어요</Text>
            <Text style={styles.muted}>{loadError}</Text>
            <Pressable onPress={() => setRetryNonce((n) => n + 1)} style={styles.retryBtn} accessibilityRole="button">
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : null}

        {notFound ? (
          <View style={styles.centerFill}>
            <Text style={styles.errorTitle}>모임을 찾을 수 없어요</Text>
            <Pressable onPress={() => router.back()} style={styles.retryBtn} accessibilityRole="button">
              <Text style={styles.retryText}>돌아가기</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !loadError && meeting !== null ? (
          <ScrollView
            ref={mainScrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            <View style={styles.titleCard}>
              <Pressable style={styles.pencilAbs} accessibilityRole="button" accessibilityLabel="제목 수정">
                <Ionicons name="pencil" size={18} color={GinitTheme.trustBlue} />
              </Pressable>
              <Text style={styles.titleCardText}>{meeting.title || '제목 없음'}</Text>
              <Text style={styles.mascotPeek} accessibilityElementsHidden>
                🤖
              </Text>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoCardTitle}>모임 등록 정보</Text>
              <Text style={styles.infoRow}>
                <Text style={styles.infoLabel}>카테고리 </Text>
                {meeting.categoryLabel?.trim() || '—'}
              </Text>
              <View style={styles.publicBadgeRow}>
                <View style={[styles.miniBadge, meeting.isPublic === false && styles.miniBadgeMuted]}>
                  <Text style={[styles.miniBadgeText, meeting.isPublic === false && styles.miniBadgeTextMuted]}>
                    {meeting.isPublic === false ? '비공개' : '공개 모집'}
                  </Text>
                </View>
                <View style={styles.miniBadge}>
                  <Text style={styles.miniBadgeText}>인원 {formatCapacityLine(meeting)}</Text>
                </View>
              </View>
              {representativeScheduleText ? (
                <Text style={styles.infoRowMuted}>{representativeScheduleText}</Text>
              ) : null}
              <Text style={styles.infoSectionLabel}>소개</Text>
              {meeting.description?.trim() ? (
                <Text style={styles.infoDescription}>{meeting.description.trim()}</Text>
              ) : (
                <Text style={styles.infoRowMuted}>등록된 소개가 없어요.</Text>
              )}

              {(specialtyKind === 'food' || extraMenus.length > 0) && (
                <>
                  <Text style={styles.infoSectionLabel}>메뉴·성향</Text>
                  {extraMenus.length > 0 ? (
                    <View style={styles.menuChipWrap}>
                      {extraMenus.map((label, mi) => (
                        <View key={`${label}-${mi}`} style={styles.menuChipRead}>
                          <Text style={styles.menuChipReadText}>{label}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.infoRowMuted}>등록된 메뉴 성향이 없어요.</Text>
                  )}
                </>
              )}

              {(specialtyKind === 'sports' || extraSport != null) && (
                <>
                  <Text style={styles.infoSectionLabel}>운동 강도</Text>
                  <Text style={styles.infoRow}>{sportIntensityKo(extraSport ?? 'normal')}</Text>
                </>
              )}
            </View>

            {isScheduleConfirmed ? (
              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>확정된 일정</Text>
                <Text style={styles.infoSectionLabel}>일시</Text>
                {confirmedDateChipResolved ? (
                  <>
                    <Text style={styles.infoRow}>{confirmedDateChipResolved.title}</Text>
                    {confirmedDateChipResolved.sub ? (
                      <Text style={styles.infoRowMuted}>{confirmedDateChipResolved.sub}</Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.infoRowMuted}>저장된 확정 일시가 없어요.</Text>
                )}
                <Text style={styles.infoSectionLabel}>장소</Text>
                {confirmedPlaceChipResolved ? (
                  <>
                    <Text style={styles.infoRow}>{confirmedPlaceChipResolved.title}</Text>
                    {confirmedPlaceChipResolved.sub ? (
                      <Text style={styles.infoRowMuted}>{confirmedPlaceChipResolved.sub}</Text>
                    ) : null}
                  </>
                ) : placeChips.length === 0 ? (
                  <Text style={styles.infoRowMuted}>등록된 장소 후보가 없었어요.</Text>
                ) : (
                  <Text style={styles.infoRowMuted}>저장된 확정 장소가 없어요.</Text>
                )}
                {confirmedPlaceCoords ? (
                  <View style={styles.confirmedMapPress}>
                    <View style={styles.confirmedMapPreviewBox}>
                      <GooglePlacePreviewMap
                        latitude={confirmedPlaceCoords.latitude}
                        longitude={confirmedPlaceCoords.longitude}
                        height={200}
                        borderRadius={12}
                      />
                      <Pressable
                        onPress={() => void onOpenConfirmedPlaceInNaverMap()}
                        style={({ pressed }) => [
                          styles.confirmedMapTapOverlay,
                          pressed && styles.confirmedMapTapOverlayPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="네이버 지도에서 이 장소 보기">
                        <View style={StyleSheet.absoluteFillObject} collapsable={false} />
                      </Pressable>
                      <View style={styles.confirmedMapBadge} pointerEvents="none">
                        <Ionicons name="navigate-outline" size={14} color="#fff" />
                        <Text style={styles.confirmedMapBadgeText}>네이버 지도</Text>
                      </View>
                    </View>
                  </View>
                ) : confirmedPlaceChipResolved ? (
                  <Text style={[styles.infoRowMuted, styles.confirmedMapMissing]}>
                    저장된 좌표가 없어 지도를 표시할 수 없어요.
                  </Text>
                ) : null}
                {(specialtyKind === 'movie' || extraMovies.length > 0) && (
                  <>
                    <Text style={styles.infoSectionLabel}>영화</Text>
                    {confirmedMovieResolved ? (
                      <View style={styles.confirmedMovieRow}>
                        {confirmedMovieResolved.posterUrl?.trim() ? (
                          <Image
                            source={{ uri: confirmedMovieResolved.posterUrl.trim() }}
                            style={styles.confirmedMoviePoster}
                            contentFit="cover"
                            transition={120}
                          />
                        ) : (
                          <View style={[styles.confirmedMoviePoster, styles.moviePosterPlaceholder]}>
                            <Ionicons name="film-outline" size={28} color="#94A3B8" />
                          </View>
                        )}
                        <View style={styles.confirmedMovieTextCol}>
                          <Text style={styles.infoRow} numberOfLines={3}>
                            {confirmedMovieResolved.title}
                            {confirmedMovieResolved.year ? ` (${confirmedMovieResolved.year})` : ''}
                          </Text>
                        </View>
                      </View>
                    ) : extraMovies.length > 0 ? (
                      <Text style={styles.infoRowMuted}>저장된 확정 영화가 없어요.</Text>
                    ) : (
                      <Text style={styles.infoRowMuted}>등록된 영화 후보가 없었어요.</Text>
                    )}
                  </>
                )}
                <Text style={[styles.placePayNote, styles.confirmedPayNoteSpacer]}>결제: 💵 1/N 정산 (안내)</Text>
              </View>
            ) : (
              <>
                <View
                  collapsable={false}
                  onLayout={(e) => {
                    voteSectionScrollYs.current.date = e.nativeEvent.layout.y;
                  }}>
                  <View style={styles.dateVoteHeaderBlock}>
                    <Text style={styles.sectionTitle}>
                      일시 투표 ({storedDateCandidates.length > 0 ? storedDateCandidates.length : dateChips.length}건)
                    </Text>
              <Text style={styles.dateVoteSub}>
                {dateHostPickMode
                  ? '동점 후보만 표시됩니다. 한 곳만 탭해 확정할 일시를 고르세요. (집계 표 숫자에는 반영되지 않아요.)'
                  : '가능한 날짜를 가로로 스크롤하며 여러 개 선택할 수 있어요.'}
              </Text>
              {dateHostPickMode ? (
                <Text style={styles.tieHostHint}>
                  확정용 선택은 투표 참여 내역과 별도이며, <Text style={styles.tieHostHintEm}>득표 수는 변하지 않습니다.</Text>
                </Text>
              ) : null}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateChipScroll}>
              {dateChipsShown.map((chip) => {
                const chipSelected = dateHostPickMode ? hostTieDateId === chip.id : selectedDateIds.includes(chip.id);
                const tally = meeting.voteTallies?.dates?.[chip.id] ?? 0;
                return (
                  <Pressable
                    key={chip.id}
                    onPress={() => onDateChipPress(chip.id)}
                    style={({ pressed }) => [
                      styles.dateChip,
                      chipSelected ? styles.dateChipSelected : null,
                      pressed ? styles.dateChipPressed : null,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: chipSelected, selected: chipSelected }}
                    accessibilityLabel={`${chip.title}${chip.sub ? ` ${chip.sub}` : ''}${chipSelected ? ', 선택됨' : ', 선택 안 됨'}`}>
                    <View style={styles.voteTallyBadge} pointerEvents="none">
                      <Text style={styles.voteTallyBadgeText}>{tally}</Text>
                    </View>
                    {chipSelected ? (
                      <View style={styles.dateChipCheckWrapLeft} pointerEvents="none">
                        <Ionicons name="checkmark-circle" size={20} color={GinitTheme.trustBlue} />
                      </View>
                    ) : null}
                    <Text style={[styles.dateChipTitle, chipSelected && styles.dateChipTitleSelected]} numberOfLines={2}>
                      {chip.title}
                    </Text>
                    {chip.sub ? (
                      <Text style={[styles.dateChipSub, chipSelected && styles.dateChipSubSelected]} numberOfLines={1}>
                        {chip.sub}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text
              style={
                dateHostPickMode
                  ? hostTieDateId
                    ? styles.dateSelectionHint
                    : styles.dateSelectionHintMuted
                  : selectedDateIds.length > 0
                    ? styles.dateSelectionHint
                    : styles.dateSelectionHintMuted
              }>
              {dateHostPickMode
                ? hostTieDateId
                  ? '확정용 1곳 선택됨 · 집계 표에는 반영되지 않아요'
                  : '확정할 일시를 한 곳만 탭해 주세요'
                : selectedDateIds.length > 0
                  ? `${selectedDateIds.length}개 선택됨`
                  : '아직 선택한 일정이 없어요'}
            </Text>

            <Pressable
              style={({ pressed }) => [styles.addOutlineBtn, pressed && styles.dateChipPressed]}
              accessibilityRole="button"
              accessibilityLabel="날짜 제안"
              onPress={openDateProposeModal}>
              <Ionicons name="calendar-outline" size={20} color={GinitTheme.trustBlue} />
              <Text style={styles.addOutlineTextActive}>날짜 제안</Text>
            </Pressable>
            </View>

            {(specialtyKind === 'movie' || extraMovies.length > 0) && (
              <View
                collapsable={false}
                onLayout={(e) => {
                  voteSectionScrollYs.current.movie = e.nativeEvent.layout.y;
                }}>
                <View style={styles.dateVoteHeaderBlock}>
                  <Text style={[styles.sectionTitle, styles.sectionSpacedTight]}>
                    영화 투표 ({extraMovies.length}건)
                  </Text>
                  <Text style={styles.dateVoteSub}>
                    {movieHostPickMode
                      ? '동점 작품만 표시됩니다. 한 곳만 탭하세요. (집계 표 숫자에는 반영되지 않아요.)'
                      : '포스터를 눌러 보고 싶은 작품을 가로로 스크롤하며 여러 개 선택할 수 있어요.'}
                  </Text>
                  {movieHostPickMode ? (
                    <Text style={styles.tieHostHint}>
                      확정용 선택은 투표 참여 내역과 별도이며, <Text style={styles.tieHostHintEm}>득표 수는 변하지 않습니다.</Text>
                    </Text>
                  ) : null}
                </View>
                {extraMovies.length > 0 ? (
                  <>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.movieScrollContent}>
                      {movieRowsShown.map(({ mv, chipId }) => {
                        const chipSelected = movieHostPickMode
                          ? hostTieMovieId === chipId
                          : selectedMovieIds.includes(chipId);
                        const tally = meeting.voteTallies?.movies?.[chipId] ?? 0;
                        return (
                          <Pressable
                            key={chipId}
                            onPress={() => onMovieChipPress(chipId)}
                            style={({ pressed }) => [
                              styles.movieVoteCard,
                              chipSelected ? styles.movieVoteCardSelected : null,
                              pressed ? styles.dateChipPressed : null,
                            ]}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: chipSelected, selected: chipSelected }}
                            accessibilityLabel={`${mv.title}${chipSelected ? ', 선택됨' : ', 선택 안 됨'}`}>
                            <View style={[styles.voteTallyBadge, styles.voteTallyBadgeMovie]} pointerEvents="none">
                              <Text style={styles.voteTallyBadgeText}>{tally}</Text>
                            </View>
                            {chipSelected ? (
                              <View style={styles.movieVoteCheckWrapLeft} pointerEvents="none">
                                <Ionicons name="checkmark-circle" size={22} color={GinitTheme.trustBlue} />
                              </View>
                            ) : null}
                            {mv.posterUrl?.trim() ? (
                              <Image
                                source={{ uri: mv.posterUrl.trim() }}
                                style={styles.moviePoster}
                                contentFit="cover"
                                transition={120}
                              />
                            ) : (
                              <View style={[styles.moviePoster, styles.moviePosterPlaceholder]}>
                                <Ionicons name="film-outline" size={28} color="#94A3B8" />
                              </View>
                            )}
                            <Text style={[styles.moviePosterTitle, chipSelected && styles.moviePosterTitleSelected]} numberOfLines={2}>
                              {mv.title}
                              {mv.year ? ` (${mv.year})` : ''}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                    <Text
                      style={
                        movieHostPickMode
                          ? hostTieMovieId
                            ? styles.dateSelectionHint
                            : styles.dateSelectionHintMuted
                          : selectedMovieIds.length > 0
                            ? styles.dateSelectionHint
                            : styles.dateSelectionHintMuted
                      }>
                      {movieHostPickMode
                        ? hostTieMovieId
                          ? '확정용 1편 선택됨 · 집계 표에는 반영되지 않아요'
                          : '확정할 작품을 한 곳만 탭해 주세요'
                        : selectedMovieIds.length > 0
                          ? `${selectedMovieIds.length}편 선택됨`
                          : '아직 선택한 영화가 없어요'}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.infoRowMuted}>등록된 영화 후보가 없어요.</Text>
                )}
              </View>
            )}

            <View
              collapsable={false}
              onLayout={(e) => {
                voteSectionScrollYs.current.place = e.nativeEvent.layout.y;
              }}>
            <View style={styles.dateVoteHeaderBlock}>
              <Text style={[styles.sectionTitle, styles.sectionSpacedTight]}>
                장소 투표 ({placeChips.length > 0 ? placeChips.length : 0}건)
              </Text>
              <Text style={styles.dateVoteSub}>
                {placeHostPickMode
                  ? '동점 장소만 표시됩니다. 한 곳만 탭하세요. (집계 표 숫자에는 반영되지 않아요.)'
                  : '가능한 장소를 가로로 스크롤하며 여러 개 선택할 수 있어요.'}
              </Text>
              {placeHostPickMode ? (
                <Text style={styles.tieHostHint}>
                  확정용 선택은 투표 참여 내역과 별도이며, <Text style={styles.tieHostHintEm}>득표 수는 변하지 않습니다.</Text>
                </Text>
              ) : null}
            </View>
            {placeChips.length > 0 ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateChipScroll}>
                  {placeChipsShown.map((chip) => {
                    const chipSelected = placeHostPickMode
                      ? hostTiePlaceId === chip.id
                      : selectedPlaceIds.includes(chip.id);
                    const tally = meeting.voteTallies?.places?.[chip.id] ?? 0;
                    return (
                      <Pressable
                        key={chip.id}
                        onPress={() => onPlaceChipPress(chip.id)}
                        style={({ pressed }) => [
                          styles.dateChip,
                          styles.placeVoteChip,
                          chipSelected ? styles.dateChipSelected : null,
                          pressed ? styles.dateChipPressed : null,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: chipSelected, selected: chipSelected }}
                        accessibilityLabel={`${chip.title}${chip.sub ? ` ${chip.sub}` : ''}${chipSelected ? ', 선택됨' : ', 선택 안 됨'}`}>
                        <View style={styles.voteTallyBadge} pointerEvents="none">
                          <Text style={styles.voteTallyBadgeText}>{tally}</Text>
                        </View>
                        {chipSelected ? (
                          <View style={styles.dateChipCheckWrapLeft} pointerEvents="none">
                            <Ionicons name="checkmark-circle" size={20} color={GinitTheme.trustBlue} />
                          </View>
                        ) : null}
                        <Text style={[styles.dateChipTitle, chipSelected && styles.dateChipTitleSelected]} numberOfLines={2}>
                          {chip.title}
                        </Text>
                        {chip.sub ? (
                          <Text style={[styles.dateChipSub, chipSelected && styles.dateChipSubSelected]} numberOfLines={2}>
                            {chip.sub}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Text
                  style={
                    placeHostPickMode
                      ? hostTiePlaceId
                        ? styles.dateSelectionHint
                        : styles.dateSelectionHintMuted
                      : selectedPlaceIds.length > 0
                        ? styles.dateSelectionHint
                        : styles.dateSelectionHintMuted
                  }>
                  {placeHostPickMode
                    ? hostTiePlaceId
                      ? '확정용 1곳 선택됨 · 집계 표에는 반영되지 않아요'
                      : '확정할 장소를 한 곳만 탭해 주세요'
                    : selectedPlaceIds.length > 0
                      ? `${selectedPlaceIds.length}개 선택됨`
                      : '아직 선택한 장소가 없어요'}
                </Text>
              </>
            ) : (
              <Text style={styles.infoRowMuted}>등록된 장소 후보가 없어요.</Text>
            )}
            <Text style={styles.placePayNote}>결제: 💵 1/N 정산 (안내)</Text>
            <Pressable style={styles.pencilPlaceRow} accessibilityRole="button" accessibilityLabel="장소 수정">
              <Ionicons name="pencil" size={18} color={GinitTheme.trustBlue} />
              <Text style={styles.pencilPlaceRowText}>장소 편집</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.addOutlineBtn, pressed && styles.dateChipPressed]}
              accessibilityRole="button"
              accessibilityLabel="장소 제안"
              onPress={openPlaceProposeModal}>
              <Ionicons name="location-outline" size={20} color={GinitTheme.trustBlue} />
              <Text style={styles.addOutlineTextActive}>장소 제안</Text>
            </Pressable>
                </View>
              </>
            )}

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>참여자 ({orderedParticipantIdsList.length}명)</Text>
            </View>
            {orderedParticipantIdsList.length === 0 ? (
              <Text style={styles.infoRowMuted}>아직 참여한 사람이 없어요.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.avatarRow}>
                {orderedParticipantIdsList.map((userId) => {
                  const prof = participantProfiles[userId];
                  const nickname = prof?.nickname ?? '…';
                  const hostPk = meeting.createdBy?.trim()
                    ? normalizeParticipantId(meeting.createdBy)
                    : '';
                  const isHostUser = Boolean(hostPk && hostPk === userId);
                  const photo = prof?.photoUrl?.trim();
                  return (
                    <View key={userId} style={styles.avatarCol}>
                      <View style={styles.avatarCircle}>
                        {photo ? (
                          <Image source={{ uri: photo }} style={styles.avatarPhoto} contentFit="cover" />
                        ) : (
                          <Text style={styles.avatarInitial}>{nicknameInitial(nickname)}</Text>
                        )}
                      </View>
                      <Text style={styles.avatarLabel} numberOfLines={2}>
                        {isHostUser ? `${nickname}\n(호스트)` : nickname}
                      </Text>
                    </View>
                  );
                })}
                {recruitmentPhase === 'recruiting' ? (
                  <Pressable style={styles.avatarAdd} accessibilityRole="button" accessibilityLabel="참여자 초대">
                    <Ionicons name="add" size={26} color={GinitTheme.trustBlue} />
                  </Pressable>
                ) : null}
              </ScrollView>
            )}

            <View style={styles.bottomSpacer} />
          </ScrollView>
        ) : null}

        {!loading && !loadError && meeting !== null && !isHost ? (
          <View style={styles.guestJoinHintWrap}>
            {!alreadyJoinedMeeting ? (
              <Text style={guestVotesReady ? styles.guestJoinHintDone : styles.guestJoinHintPending}>
                {meeting.scheduleConfirmed === true
                  ? '일정이 확정되었어요. 아래 참여를 눌러 주세요.'
                  : guestVotesReady
                    ? '투표를 모두 골랐어요. 아래 참여를 눌러 주세요.'
                    : '참여하려면 일시·장소' +
                        (needsMoviePick ? '·영화' : '') +
                        ' 투표에서 각각 최소 한 가지 이상 선택해 주세요.'}
              </Text>
            ) : participantVoteLogMissing ? (
              <Text style={styles.guestJoinHintPending}>
                이 모임은 예전 방식으로만 참여되어 있어요. 투표를 바꾸려면 탈퇴 후 다시 참여해 주세요.
              </Text>
            ) : meeting.scheduleConfirmed === true ? (
              <Text style={styles.guestJoinHintDone}>일정이 확정된 모임이에요.</Text>
            ) : (
              <Text style={guestVotesReady ? styles.guestJoinHintDone : styles.guestJoinHintPending}>
                {guestVotesReady
                  ? '투표를 바꾼 뒤 아래 수정으로 저장해 주세요.'
                  : '저장하려면 일시·장소' +
                      (needsMoviePick ? '·영화' : '') +
                      ' 투표에서 각각 최소 한 가지 이상 선택해 주세요.'}
              </Text>
            )}
          </View>
        ) : null}

        {!loading && !loadError && meeting !== null ? (
          <View style={[styles.bottomBar, { paddingBottom: 12 + insets.bottom }]}>
            {isHost ? (
              <View style={styles.bottomBarEqualRow}>
                {recruitmentPhase === 'recruiting' || recruitmentPhase === 'full' ? (
                  <Pressable
                    style={[styles.bottomPill, styles.pillBlue, styles.bottomPillFlex]}
                    accessibilityRole="button"
                    accessibilityLabel="모임 수정">
                    <Ionicons name="construct-outline" size={18} color="#fff" />
                    <Text style={[styles.pillText, styles.bottomPillLabel]} numberOfLines={1} ellipsizeMode="tail">
                      수정
                    </Text>
                  </Pressable>
                ) : null}
                {recruitmentPhase === 'recruiting' ? (
                  <Pressable
                    style={[styles.bottomPill, styles.pillBlue, styles.bottomPillFlex]}
                    accessibilityRole="button"
                    accessibilityLabel="초대">
                    <Ionicons name="mail-outline" size={18} color="#fff" />
                    <Text style={[styles.pillText, styles.bottomPillLabel]} numberOfLines={1} ellipsizeMode="tail">
                      초대
                    </Text>
                  </Pressable>
                ) : null}
                {meeting.scheduleConfirmed !== true ? (
                  <Pressable
                    onPress={handleDeleteMeeting}
                    disabled={deleteMeetingBusy || confirmScheduleBusy}
                    style={({ pressed }) => [
                      styles.bottomPill,
                      styles.pillDanger,
                      styles.bottomPillFlex,
                      (deleteMeetingBusy || confirmScheduleBusy) && { opacity: 0.75 },
                      pressed && !deleteMeetingBusy && !confirmScheduleBusy && { opacity: 0.9 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="모임 삭제">
                    {deleteMeetingBusy ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Ionicons name="trash-outline" size={18} color="#fff" />
                    )}
                    <Text style={[styles.pillText, styles.bottomPillLabel]} numberOfLines={1} ellipsizeMode="tail">
                      삭제
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={
                    meeting.scheduleConfirmed === true ? handleUnconfirmMeetingSchedule : handleConfirmSchedule
                  }
                  disabled={confirmScheduleBusy || deleteMeetingBusy}
                  style={({ pressed }) => [
                    styles.bottomPill,
                    meeting.scheduleConfirmed === true ? styles.pillDanger : styles.pillOrange,
                    styles.bottomPillFlex,
                    (confirmScheduleBusy || deleteMeetingBusy) && { opacity: 0.75 },
                    pressed && !confirmScheduleBusy && !deleteMeetingBusy && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    meeting.scheduleConfirmed === true ? '일정 확정 취소' : '모집 일정 확정'
                  }>
                  {confirmScheduleBusy ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Ionicons
                      name={meeting.scheduleConfirmed === true ? 'close-circle-outline' : 'checkmark-circle'}
                      size={18}
                      color="#fff"
                    />
                  )}
                  <Text style={[styles.pillText, styles.bottomPillLabel]} numberOfLines={1} ellipsizeMode="tail">
                    {meeting.scheduleConfirmed === true ? '취소' : '확정'}
                  </Text>
                </Pressable>
              </View>
            ) : alreadyJoinedMeeting ? (
              <View style={styles.bottomBarEqualRow}>
                {recruitmentPhase === 'recruiting' ? (
                  <Pressable
                    style={[styles.bottomPill, styles.pillBlue, styles.bottomPillFlex]}
                    accessibilityRole="button"
                    accessibilityLabel="초대">
                    <Ionicons name="mail-outline" size={16} color="#fff" />
                    <Text
                      style={[styles.pillText, styles.pillTextCompact, styles.bottomPillLabel]}
                      numberOfLines={1}
                      ellipsizeMode="tail">
                      초대
                    </Text>
                  </Pressable>
                ) : null}
                {meeting.scheduleConfirmed !== true ? (
                  <Pressable
                    onPress={() => void handleSaveParticipantVotes()}
                    disabled={participantSaveDisabled}
                    style={({ pressed }) => [
                      styles.bottomPill,
                      styles.pillBlue,
                      styles.bottomPillFlex,
                      participantSaveDisabled && { opacity: 0.75 },
                      pressed && !participantSaveDisabled && { opacity: 0.9 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="투표 수정 저장">
                    {participantVoteBusy ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Ionicons name="save-outline" size={16} color="#fff" />
                    )}
                    <Text
                      style={[styles.pillText, styles.pillTextCompact, styles.bottomPillLabel]}
                      numberOfLines={1}
                      ellipsizeMode="tail">
                      수정
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={handleLeaveParticipant}
                  disabled={participantVoteBusy}
                  style={({ pressed }) => [
                    styles.bottomPill,
                    styles.pillDanger,
                    styles.bottomPillFlex,
                    participantVoteBusy && { opacity: 0.75 },
                    pressed && !participantVoteBusy && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="모임 탈퇴">
                  <Ionicons name="exit-outline" size={16} color="#fff" />
                  <Text
                    style={[styles.pillText, styles.pillTextCompact, styles.bottomPillLabel]}
                    numberOfLines={1}
                    ellipsizeMode="tail">
                    탈퇴
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.bottomBarEqualRow}>
                {recruitmentPhase === 'recruiting' ? (
                  <Pressable
                    style={[styles.bottomPill, styles.pillBlue, styles.bottomPillFlex]}
                    accessibilityRole="button"
                    accessibilityLabel="초대">
                    <Ionicons name="mail-outline" size={18} color="#fff" />
                    <Text style={[styles.pillText, styles.bottomPillLabel]} numberOfLines={1} ellipsizeMode="tail">
                      초대
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => void handleJoinMeeting()}
                  disabled={joinBusy || !guestVotesReady}
                  style={({ pressed }) => [
                    styles.bottomPill,
                    styles.pillOrange,
                    styles.bottomPillFlex,
                    (joinBusy || !guestVotesReady) && { opacity: 0.75 },
                    pressed && !joinBusy && guestVotesReady && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="모임 참여">
                  {joinBusy ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Ionicons name="hand-right-outline" size={18} color="#fff" />
                  )}
                  <Text style={[styles.pillText, styles.bottomPillLabel]} numberOfLines={1} ellipsizeMode="tail">
                    참여
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}

        <Modal
          visible={proposeOpen}
          animationType="fade"
          transparent
          onRequestClose={() => !proposeSaving && setProposeOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalRoot}>
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => !proposeSaving && setProposeOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="닫기"
            />
            <View style={[styles.modalSheetDark, { maxHeight: Math.round(windowHeight * 0.88) }]}>
              <Text style={styles.modalTitleLight}>날짜 제안</Text>
              <Text style={styles.modalSubLight}>
                기존 일정 목록은 여기서 바꾸지 않아요. 새로 넣을 일시만 추가하면 기존 후보 뒤에 붙습니다.
              </Text>
              {proposeInitialPayload ? (
                <ScrollView
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  style={styles.modalFormScroll}
                  contentContainerStyle={styles.modalFormScrollContent}>
                  <VoteCandidatesForm
                    key={proposeFormKey}
                    ref={voteFormRef}
                    seedPlaceQuery=""
                    seedScheduleDate={insertModalSchedule.scheduleDate}
                    seedScheduleTime={insertModalSchedule.scheduleTime}
                    initialPayload={proposeInitialPayload}
                    bare
                    wizardSegment="schedule"
                  />
                </ScrollView>
              ) : null}
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => !proposeSaving && setProposeOpen(false)}
                  style={({ pressed }) => [styles.modalBtnGhostDark, pressed && styles.dateChipPressed]}
                  accessibilityRole="button">
                  <Text style={styles.modalBtnGhostTextLight}>취소</Text>
                </Pressable>
                <Pressable
                  onPress={() => void confirmDateProposals()}
                  disabled={proposeSaving}
                  style={({ pressed }) => [
                    styles.modalBtnPrimary,
                    (pressed || proposeSaving) && { opacity: proposeSaving ? 0.7 : 0.9 },
                  ]}
                  accessibilityRole="button">
                  {proposeSaving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalBtnPrimaryText}>후보 저장</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          visible={placeProposeOpen}
          animationType="fade"
          transparent
          onRequestClose={() => !placeProposeSaving && setPlaceProposeOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalRoot}>
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => !placeProposeSaving && setPlaceProposeOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="닫기"
            />
            <View style={[styles.modalSheetDark, { maxHeight: Math.round(windowHeight * 0.88) }]}>
              <Text style={styles.modalTitleLight}>장소 제안</Text>
              <Text style={styles.modalSubLight}>
                기존 장소 목록은 여기서 바꾸지 않아요. 새로 넣을 장소만 추가하면 기존 후보 뒤에 붙습니다.
              </Text>
              {placeProposeInitialPayload ? (
                <ScrollView
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  style={styles.modalFormScroll}
                  contentContainerStyle={styles.modalFormScrollContent}>
                  <VoteCandidatesForm
                    key={placeProposeFormKey}
                    ref={placeVoteFormRef}
                    seedPlaceQuery=""
                    seedScheduleDate={insertModalSchedule.scheduleDate}
                    seedScheduleTime={insertModalSchedule.scheduleTime}
                    initialPayload={placeProposeInitialPayload}
                    bare
                    wizardSegment="places"
                  />
                </ScrollView>
              ) : null}
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => !placeProposeSaving && setPlaceProposeOpen(false)}
                  style={({ pressed }) => [styles.modalBtnGhostDark, pressed && styles.dateChipPressed]}
                  accessibilityRole="button">
                  <Text style={styles.modalBtnGhostTextLight}>취소</Text>
                </Pressable>
                <Pressable
                  onPress={() => void confirmPlaceProposals()}
                  disabled={placeProposeSaving}
                  style={({ pressed }) => [
                    styles.modalBtnPrimary,
                    (pressed || placeProposeSaving) && { opacity: placeProposeSaving ? 0.7 : 0.9 },
                  ]}
                  accessibilityRole="button">
                  {placeProposeSaving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalBtnPrimaryText}>후보 저장</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 4,
  },
  iconBtn: { padding: 8, borderRadius: 12 },
  pressed: { opacity: 0.7 },
  topTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: '#1A1A1A', textAlign: 'center' },
  statusBadgePlaceholder: { minWidth: 72, height: 30, marginRight: 4 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 4,
    maxWidth: 120,
  },
  statusBadgeGreen: { backgroundColor: '#16A34A' },
  statusBadgeYellow: { backgroundColor: '#FACC15' },
  statusBadgeBlack: { backgroundColor: '#171717' },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },
  statusBadgeTextLight: { color: '#fff' },
  statusBadgeTextOnYellow: { color: '#422006' },
  centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, padding: 24 },
  muted: { color: '#5C6570', fontSize: 14 },
  errorTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A' },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: GinitTheme.trustBlue,
  },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 12 },
  titleCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    paddingRight: 56,
    marginBottom: 20,
    shadowColor: 'rgba(15, 23, 42, 0.12)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 4,
    position: 'relative',
    overflow: 'visible',
  },
  pencilAbs: { position: 'absolute', top: 14, right: 14, zIndex: 2, padding: 4 },
  titleCardText: { fontSize: 18, fontWeight: '700', color: '#1A1A1A', lineHeight: 26 },
  mascotPeek: { position: 'absolute', right: 4, bottom: -4, fontSize: 36 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A1A' },
  sectionSpaced: { marginTop: 20, marginBottom: 10 },
  sectionSpacedTight: { marginTop: 4, marginBottom: 0 },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    gap: 6,
    shadowColor: 'rgba(15, 23, 42, 0.08)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 3,
  },
  infoCardTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A1A', marginBottom: 4 },
  infoLabel: { fontWeight: '700', color: '#64748B' },
  infoRow: { fontSize: 14, color: '#1A1A1A', lineHeight: 21 },
  infoRowMuted: { fontSize: 13, color: '#8B95A1', lineHeight: 19 },
  infoSectionLabel: { fontSize: 12, fontWeight: '700', color: '#8B95A1', marginTop: 10 },
  infoDescription: { fontSize: 14, color: '#334155', lineHeight: 22 },
  publicBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  miniBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 82, 204, 0.1)',
  },
  miniBadgeMuted: { backgroundColor: '#F1F5F9' },
  miniBadgeText: { fontSize: 12, fontWeight: '700', color: GinitTheme.trustBlue },
  miniBadgeTextMuted: { color: '#64748B' },
  movieScrollContent: { flexDirection: 'row', gap: 12, paddingVertical: 4, paddingRight: 8 },
  movieVoteCard: {
    width: 108,
    padding: 4,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E4E9EF',
    backgroundColor: '#fff',
    position: 'relative',
    overflow: 'visible',
    shadowColor: 'rgba(15, 23, 42, 0.06)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  movieVoteCardSelected: {
    borderColor: GinitTheme.trustBlue,
    backgroundColor: 'rgba(0, 82, 204, 0.07)',
  },
  movieVoteCheckWrapLeft: { position: 'absolute', top: 5, left: 4, zIndex: 5 },
  moviePoster: { width: 100, height: 148, borderRadius: 10, backgroundColor: '#E2E8F0', alignSelf: 'center' },
  moviePosterPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  moviePosterTitle: { fontSize: 12, fontWeight: '600', color: '#334155', marginTop: 8, lineHeight: 16 },
  moviePosterTitleSelected: { color: GinitTheme.trustBlue },
  confirmedMovieRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  confirmedMoviePoster: {
    width: 72,
    height: 106,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
  },
  confirmedMovieTextCol: { flex: 1, minWidth: 0 },
  confirmedPayNoteSpacer: { marginTop: 12 },
  confirmedMapPress: {
    marginTop: 10,
    alignSelf: 'stretch',
  },
  confirmedMapPreviewBox: {
    position: 'relative',
    alignSelf: 'stretch',
    borderRadius: 12,
    overflow: 'hidden',
  },
  /** 장소검색 인라인 지도와 동일 — 스크롤 비활성 MapView 위 탭만 네이버 지도로 연결 */
  confirmedMapTapOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    borderRadius: 12,
  },
  confirmedMapTapOverlayPressed: {
    backgroundColor: 'rgba(15, 23, 42, 0.07)',
  },
  confirmedMapBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  confirmedMapBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  confirmedMapMissing: { marginTop: 8 },
  menuChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  menuChipRead: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#FFF5EB',
    borderWidth: 1,
    borderColor: 'rgba(255, 138, 61, 0.28)',
  },
  menuChipReadText: { fontSize: 12, fontWeight: '600', color: '#C2410C' },
  dateVoteHeaderBlock: { marginBottom: 10, gap: 4 },
  dateVoteSub: { fontSize: 12, color: '#5C6570', lineHeight: 17 },
  tieHostHint: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#92400e',
    lineHeight: 19,
  },
  tieHostHintEm: { fontWeight: '800', color: '#b45309' },
  dateChipScroll: { flexDirection: 'row', gap: 10, paddingBottom: 6, paddingRight: 8 },
  placeVoteChip: { minWidth: 148, maxWidth: 220 },
  dateChip: {
    minWidth: 112,
    maxWidth: 140,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#E4E9EF',
    position: 'relative',
    overflow: 'visible',
    shadowColor: 'rgba(15, 23, 42, 0.06)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  dateChipSelected: {
    borderColor: GinitTheme.trustBlue,
    backgroundColor: 'rgba(0, 82, 204, 0.07)',
  },
  dateChipPressed: { opacity: 0.9 },
  dateChipCheckWrapLeft: { position: 'absolute', top: 5, left: 5, zIndex: 5 },
  /** 일시·장소 칩 — 카드 우상단 코너에 밀착 */
  voteTallyBadge: {
    position: 'absolute',
    top: -1,
    right: -1,
    zIndex: 6,
    minWidth: 27,
    height: 25,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderWidth: 1,
    borderColor: 'rgba(0, 82, 204, 0.12)',
    shadowColor: 'rgba(15, 23, 42, 0.12)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 3,
  },
  /** 영화 카드 — 내부 padding을 넘어 외곽 모서리에 맞춤 */
  voteTallyBadgeMovie: {
    top: -3,
    right: -3,
    borderTopRightRadius: 12,
  },
  voteTallyBadgeText: {
    color: GinitTheme.trustBlue,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  },
  dateChipTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A1A', textAlign: 'center' },
  dateChipTitleSelected: { color: GinitTheme.trustBlue },
  dateChipSub: { fontSize: 13, fontWeight: '600', color: '#5C6570', textAlign: 'center', marginTop: 6 },
  dateChipSubSelected: { color: GinitTheme.trustBlue },
  dateSelectionHint: { fontSize: 13, color: GinitTheme.trustBlue, fontWeight: '600', marginTop: 8 },
  dateSelectionHintMuted: { fontSize: 12, color: '#8B95A1', marginTop: 8 },
  addOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D0D7E0',
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  addOutlineText: { fontSize: 15, fontWeight: '600', color: '#5C6570' },
  addOutlineTextActive: { fontSize: 15, fontWeight: '700', color: GinitTheme.trustBlue },
  modalRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: 12 },
  modalBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  modalSheetDark: {
    zIndex: 2,
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 16,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  modalTitleLight: { fontSize: 18, fontWeight: '700', color: '#F8FAFC', marginBottom: 6 },
  modalSubLight: { fontSize: 13, color: 'rgba(248, 250, 252, 0.72)', lineHeight: 19, marginBottom: 8 },
  modalFormScroll: { flexGrow: 0 },
  modalFormScrollContent: { paddingBottom: 12 },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  modalBtnGhostDark: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  modalBtnGhostTextLight: { fontSize: 15, fontWeight: '600', color: 'rgba(248, 250, 252, 0.85)' },
  modalBtnPrimary: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: GinitTheme.trustBlue,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnPrimaryText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  placePayNote: { fontSize: 12, color: '#5C6570', marginTop: 10 },
  pencilPlaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  pencilPlaceRowText: { fontSize: 14, fontWeight: '600', color: GinitTheme.trustBlue },
  avatarRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 4 },
  avatarCol: { width: 64, alignItems: 'center' },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#E8F2FF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: 'rgba(0,0,0,0.1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  avatarPhoto: { width: 52, height: 52, borderRadius: 26 },
  avatarInitial: { fontSize: 18, fontWeight: '700', color: GinitTheme.trustBlue },
  avatarLabel: { marginTop: 6, fontSize: 11, color: '#333', textAlign: 'center', lineHeight: 14 },
  avatarAdd: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: GinitTheme.trustBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
    opacity: 0.85,
  },
  bottomSpacer: { height: 100 },
  guestJoinHintWrap: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 2,
    backgroundColor: 'transparent',
  },
  guestJoinHintPending: {
    fontSize: 12,
    color: '#92400e',
    lineHeight: 17,
    textAlign: 'center',
    fontWeight: '600',
  },
  guestJoinHintDone: {
    fontSize: 12,
    color: GinitTheme.trustBlue,
    lineHeight: 17,
    textAlign: 'center',
    fontWeight: '600',
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    backgroundColor: 'transparent',
  },
  /** 보이는 버튼만큼 동일 비율(flex 1)로 화면 너비 분배 */
  bottomBarEqualRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    minWidth: 0,
  },
  bottomPillLabel: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'center',
  },
  bottomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 22,
  },
  /** 게스트 2버튼일 때 가로 폭 균등 */
  bottomPillFlex: { flex: 1, minWidth: 0 },
  pillBlue: { backgroundColor: GinitTheme.trustBlue },
  pillOrange: { backgroundColor: GinitTheme.pointOrange },
  pillDanger: { backgroundColor: '#DC2626' },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  pillTextCompact: { fontSize: 12 },
});
