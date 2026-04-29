import { VoteCandidatesForm, type VoteCandidatesFormHandle } from '@/app/create/details';
import { CAPACITY_UNLIMITED } from '@/components/create/GlassDualCapacityWheel';
import { GooglePlacePreviewMap } from '@/components/GooglePlacePreviewMap';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
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

import { NaverPlaceWebViewModal } from '@/components/NaverPlaceWebViewModal';
import { VoteCandidateListV } from '@/components/meeting/VoteCandidateListV';
import { KeyboardAwareScreenScroll, ScreenShell } from '@/components/ui';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { GinitTheme } from '@/constants/ginit-theme';
import { useAppPolicies } from '@/src/context/AppPoliciesContext';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { meetingDetailQueryKey, useMeetingDetailQuery } from '@/src/hooks/use-meeting-detail-query';
import { getPolicy } from '@/src/lib/app-policies-store';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { resolveSpecialtyKind, type SpecialtyKind } from '@/src/lib/category-specialty';
import { createPointCandidate, fmtDateYmd, normalizeTimeInput } from '@/src/lib/date-candidate';
import { notifyFriendRequestReceivedFireAndForget } from '@/src/lib/friend-push-notify';
import {
  acceptGinitRequest,
  fetchFriendRelationStatus,
  sendGinitRequest,
  type FriendRelationStatusRow,
} from '@/src/lib/friends';
import { isHighTrustPublicMeeting } from '@/src/lib/ginit-trust';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { MeetingExtraData, SelectedMovieExtra, SportIntensityLevel } from '@/src/lib/meeting-extra-data';
import type { DateCandidate, PlaceCandidate, VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import {
  assertDateCandidatesNoOverlapWithOtherMeetings,
  assertNoConfirmedScheduleOverlapHybrid,
  DATE_CANDIDATE_OVERLAP_BUFFER_HOURS,
  getScheduleOverlapBufferHours,
  GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION,
  isConfirmedScheduleOverlapErrorMessage,
} from '@/src/lib/meeting-schedule-overlap';
import type { Meeting } from '@/src/lib/meetings';
import {
  applyTrustPenaltyLeaveConfirmedMeeting,
  computeMeetingConfirmAnalysis,
  confirmMeetingSchedule,
  deleteMeetingByHost,
  formatPublicMeetingAgeSummary,
  formatPublicMeetingApprovalSummary,
  formatPublicMeetingGenderSummary,
  formatPublicMeetingSettlementSummary,
  getMeetingById,
  getMeetingRecruitmentPhase,
  getParticipantVoteSnapshot,
  joinMeeting,
  leaveMeeting,
  meetingPrimaryStartMs,
  parsePublicMeetingDetailsConfig,
  resolveVoteTopTies,
  unconfirmMeetingSchedule,
  updateMeetingDateCandidates,
  updateMeetingPlaceCandidates,
  updateParticipantVotes,
  upsertParticipantVotes,
} from '@/src/lib/meetings';
import { invalidateNearbySearchBiasCache } from '@/src/lib/nearby-search-bias';
import {
  resolveNaverPlaceDetailWebUrlLikeVoteChip,
  sanitizeNaverLocalPlaceLink,
} from '@/src/lib/naver-local-search';
import { openNaverMapAt } from '@/src/lib/open-naver-map';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { markRecentSelfMeetingChange } from '@/src/lib/self-meeting-change';
import { socialDmRoomId } from '@/src/lib/social-chat-rooms';
import { notifyTrustPenaltyAppliedFireAndForget } from '@/src/lib/trust-penalty-notify';
import { searchNaverImageThumbnail } from '@/src/lib/naver-image-search';
import {
  ensureUserProfile,
  getUserProfile,
  getUserProfilesForIds,
  isMeetingServiceComplianceComplete,
  isUserProfileWithdrawn,
  meetingDemographicsIncomplete,
  WITHDRAWN_NICKNAME,
  type UserProfile,
} from '@/src/lib/user-profile';

const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;
const WEEKDAY_KO = WEEK_KO;

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

type PlaceChip = { id: string; title: string; sub?: string; naverPlaceLink?: string };

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
    return list.map((p, i) => {
      const nl = sanitizeNaverLocalPlaceLink(p.naverPlaceLink ?? undefined);
      return {
        id: placeCandidateChipId(p, i),
        title: p.placeName?.trim() || '장소',
        sub: p.address?.trim() || undefined,
        ...(nl ? { naverPlaceLink: nl } : {}),
      };
    });
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

/** 세션 사용자 PK와 모임 `createdBy`가 같으면 주선자 */
function isMeetingHost(sessionUserId: string | null, createdBy: string | null | undefined): boolean {
  const s = sessionUserId?.trim() ?? '';
  const c = createdBy?.trim() ?? '';
  if (!s || !c) return false;
  return normalizeParticipantId(s) === normalizeParticipantId(c);
}

export default function MeetingDetailScreen() {
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { userId } = useUserSession();
  const { version: appPoliciesVersion } = useAppPolicies();
  const { syncMeetingAckFromMeeting } = useInAppAlarms();
  const isFocused = useIsFocused();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';
  const queryClient = useQueryClient();
  const navigation = useNavigation();

  /** 일시 투표 — 후보 id 다중 선택 (로컬 UI, 추후 서버 반영) */
  const [selectedDateIds, setSelectedDateIds] = useState<string[]>([]);
  /** 장소 투표 — 후보 id 다중 선택 (로컬 UI, 추후 서버 반영) */
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<string[]>([]);
  const [placeThumbByChipId, setPlaceThumbByChipId] = useState<Record<string, string | null>>({});
  const [dateVoteCalendarMonth, setDateVoteCalendarMonth] = useState(() => monthStartYmd(fmtDateYmd(new Date())));
  const [dateVoteTimePick, setDateVoteTimePick] = useState<{ ymd: string } | null>(null);
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
  const { meeting, loading, loadError, refetch: refetchMeetingDetail } = useMeetingDetailQuery(id, retryNonce);
  const [participantProfiles, setParticipantProfiles] = useState<Record<string, UserProfile>>({});
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinScheduleOverlapBlock, setJoinScheduleOverlapBlock] = useState(false);
  const [joinOverlapBufferHours, setJoinOverlapBufferHours] = useState(3);
  const [participantVoteBusy, setParticipantVoteBusy] = useState(false);
  /** ref만 갱신해도 `votesDirty` useMemo가 다시 계산되도록 */
  const [votePersistNonce, setVotePersistNonce] = useState(0);
  const [confirmScheduleBusy, setConfirmScheduleBusy] = useState(false);
  const [deleteMeetingBusy, setDeleteMeetingBusy] = useState(false);
  const [hostTieDateId, setHostTieDateId] = useState<string | null>(null);
  const [hostTiePlaceId, setHostTiePlaceId] = useState<string | null>(null);
  const [hostTieMovieId, setHostTieMovieId] = useState<string | null>(null);
  const [naverPlaceWebModal, setNaverPlaceWebModal] = useState<{ url: string; title: string } | null>(null);

  const [profilePopupUserId, setProfilePopupUserId] = useState<string | null>(null);
  const [friendRequestBusy, setFriendRequestBusy] = useState(false);
  const [friendRelation, setFriendRelation] = useState<FriendRelationStatusRow>({
    status: 'none',
    friendship_id: null,
  });
  /** 친구 관계 조회 응답이 늦게 도착해 요청 직후 상태를 덮어쓰지 않도록 세대를 맞춥니다. */
  const friendsRelationFetchGenRef = useRef(0);
  const [meetingAuthGateReady, setMeetingAuthGateReady] = useState(false);
  const [meetingAuthComplete, setMeetingAuthComplete] = useState(false);

  useEffect(() => {
    if (!isFocused || !meeting || !userId?.trim()) return;
    if (!isUserJoinedMeeting(meeting, userId)) return;
    // 호스트는 모임 변동(입장/퇴장 등)을 "새 소식"으로 계속 받아야 해서
    // 상세 화면에 들어와 있다고 자동으로 확인 처리(sync ack)하지 않습니다.
    if (isMeetingHost(userId, meeting.createdBy)) return;
    syncMeetingAckFromMeeting(meeting);
  }, [isFocused, meeting, userId, syncMeetingAckFromMeeting]);

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
      const rec: Record<string, UserProfile> = {};
      map.forEach((v, k) => {
        rec[k] = v;
      });
      setParticipantProfiles(rec);
    });
    return () => {
      cancelled = true;
    };
  }, [meeting]);

  const normalizeGender = useCallback((raw: string | null | undefined): 'male' | 'female' | null => {
    const v = String(raw ?? '').trim().toLowerCase();
    if (!v) return null;
    if (v === 'male' || v === 'man' || v === 'm' || v === '남' || v === '남자') return 'male';
    if (v === 'female' || v === 'woman' || v === 'f' || v === '여' || v === '여자') return 'female';
    // Google People API가 주는 값(예: "male", "female", "unspecified") 외에도, 한글/약어 혼재 대비
    if (v.includes('male') || v.includes('man')) return 'male';
    if (v.includes('female') || v.includes('woman')) return 'female';
    if (v.includes('남')) return 'male';
    if (v.includes('여')) return 'female';
    return null;
  }, []);

  const openParticipantProfile = useCallback((peerAppUserId: string) => {
    const pid = peerAppUserId.trim();
    if (!pid) return;
    setProfilePopupUserId(pid);
  }, []);

  const closeParticipantProfile = useCallback(() => {
    setProfilePopupUserId(null);
    setFriendRelation({ status: 'none', friendship_id: null });
  }, []);

  const openPlaceVoteDetailWeb = useCallback((chip: PlaceChip) => {
    const url = resolveNaverPlaceDetailWebUrlLikeVoteChip({
      naverPlaceLink: chip.naverPlaceLink,
      title: chip.title,
      addressLine: chip.sub,
    });
    if (!url) {
      Alert.alert('안내', '표시할 상세 정보를 불러올 수 없어요.');
      return;
    }
    setNaverPlaceWebModal({
      url,
      title: chip.title.trim() || '장소 상세',
    });
  }, []);

  useEffect(() => {
    const pid = profilePopupUserId?.trim() ?? '';
    if (!pid) return;
    if (participantProfiles[pid]) return;
    let alive = true;
    void getUserProfile(pid).then((p) => {
      if (!alive) return;
      if (!p) return;
      setParticipantProfiles((prev) => (prev[pid] ? prev : { ...prev, [pid]: p }));
    });
    return () => {
      alive = false;
    };
  }, [participantProfiles, profilePopupUserId]);

  useEffect(() => {
    const me = userId?.trim() ?? '';
    const peer = profilePopupUserId?.trim() ?? '';
    if (!me || !peer) {
      setFriendRelation({ status: 'none', friendship_id: null });
      return;
    }
    if (normalizeParticipantId(me) === normalizeParticipantId(peer)) {
      setFriendRelation({ status: 'none', friendship_id: null });
      return;
    }
    const snapshot = friendsRelationFetchGenRef.current;
    let alive = true;
    void fetchFriendRelationStatus(me, peer)
      .then((gr) => {
        if (!alive) return;
        if (snapshot !== friendsRelationFetchGenRef.current) return;
        setFriendRelation(gr);
      })
      .catch(() => {
        if (!alive) return;
        if (snapshot !== friendsRelationFetchGenRef.current) return;
        setFriendRelation({ status: 'none', friendship_id: null });
      });
    return () => {
      alive = false;
    };
  }, [profilePopupUserId, userId]);

  const onSendFriendGinit = useCallback(async () => {
    const me = userId?.trim() ?? '';
    const peer = profilePopupUserId?.trim() ?? '';
    if (!peer) return;
    if (!me) {
      Alert.alert('로그인이 필요해요', '친구 요청은 로그인 후 보낼 수 있어요.');
      return;
    }
    if (normalizeParticipantId(me) === normalizeParticipantId(peer)) return;
    setFriendRequestBusy(true);
    try {
      await ensureUserProfile(me);
      const profGate = await getUserProfile(me);
      if (meetingDemographicsIncomplete(profGate, me)) {
        Alert.alert(
          '프로필을 먼저 완성해 주세요',
          '친구 요청은 모임을 위한 사용자 정보 등록(성별·연령대) 완료 후 보낼 수 있어요.',
          [
            { text: '닫기', style: 'cancel' },
            { text: '정보 등록하기', onPress: () => pushProfileOpenRegisterInfo(router) },
          ],
        );
        return;
      }
      const pre = await fetchFriendRelationStatus(me, peer).catch(() => null);
      if (pre?.status === 'pending_out' || pre?.status === 'accepted') {
        friendsRelationFetchGenRef.current += 1;
        setFriendRelation(pre);
        showTransientBottomMessage(
          pre.status === 'accepted' ? '이미 친구로 연결되어 있어요.' : '이미 친구 요청을 보냈어요.',
        );
        return;
      }
      const returnedId = (await sendGinitRequest(me, peer)).trim();
      friendsRelationFetchGenRef.current += 1;
      const next = await fetchFriendRelationStatus(me, peer).catch(() => null);
      const resolved: FriendRelationStatusRow =
        next &&
        (next.status === 'pending_out' || next.status === 'pending_in' || next.status === 'accepted')
          ? next
          : returnedId
            ? {
                status: 'pending_out',
                friendship_id: returnedId,
                requester_app_user_id: me,
                addressee_app_user_id: peer,
              }
            : (next ?? { status: 'none', friendship_id: null });
      setFriendRelation(resolved);
      showTransientBottomMessage('친구 요청을 보냈어요.');
      void getUserProfile(me)
        .then((p) =>
          notifyFriendRequestReceivedFireAndForget({
            addresseeAppUserId: peer,
            requesterAppUserId: me,
            requesterDisplayName: p?.nickname ?? undefined,
          }),
        )
        .catch(() =>
          notifyFriendRequestReceivedFireAndForget({
            addresseeAppUserId: peer,
            requesterAppUserId: me,
          }),
        );
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setFriendRequestBusy(false);
    }
  }, [profilePopupUserId, router, userId]);

  const onAcceptFriendGinit = useCallback(async () => {
    const me = userId?.trim() ?? '';
    const peer = profilePopupUserId?.trim() ?? '';
    const fid = friendRelation.friendship_id?.trim();
    if (!me || !peer || !fid) return;
    setFriendRequestBusy(true);
    try {
      await ensureUserProfile(me);
      await acceptGinitRequest(me, fid);
      friendsRelationFetchGenRef.current += 1;
      const next = await fetchFriendRelationStatus(me, peer).catch(() => null);
      if (next) setFriendRelation(next);
      const nick =
        participantProfiles[normalizeParticipantId(peer) ?? peer]?.nickname?.trim() ?? '친구';
      const rid = socialDmRoomId(me, peer);
      showTransientBottomMessage('친구 요청을 수락했어요.');
      closeParticipantProfile();
      router.push(`/social-chat/${encodeURIComponent(rid)}?peerName=${encodeURIComponent(nick)}`);
    } catch (e) {
      Alert.alert('수락 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setFriendRequestBusy(false);
    }
  }, [
    closeParticipantProfile,
    friendRelation.friendship_id,
    participantProfiles,
    profilePopupUserId,
    router,
    userId,
  ]);

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

  const singlePlaceCoords = useMemo(() => {
    if (!meeting || placeChips.length !== 1) return null;
    if (meeting.placeCandidates?.length === 1) {
      const lat = meeting.placeCandidates[0].latitude;
      const lng = meeting.placeCandidates[0].longitude;
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { latitude: lat, longitude: lng };
      return null;
    }
    const lat = meeting.latitude;
    const lng = meeting.longitude;
    if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) return { latitude: lat, longitude: lng };
    return null;
  }, [meeting, meeting?.placeCandidates, meeting?.latitude, meeting?.longitude, placeChips.length]);

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

  const publicMeetingDetails = useMemo(() => {
    if (!meeting || meeting.isPublic === false) return null;
    return parsePublicMeetingDetailsConfig(meeting.meetingConfig);
  }, [meeting]);

  type PublicConditionRow = {
    icon: ComponentProps<typeof Ionicons>['name'];
    label: string;
    value: string;
    variant?: 'default' | 'trust';
  };

  const publicConditionRows = useMemo((): PublicConditionRow[] => {
    if (!publicMeetingDetails) return [];
    const d = publicMeetingDetails;
    const highTrust = isHighTrustPublicMeeting(d);
    const rows: PublicConditionRow[] = [
      {
        icon: 'calendar-outline',
        label: '모집 연령대',
        value: formatPublicMeetingAgeSummary(d.ageLimit),
      },
      {
        icon: 'male-female-outline',
        label: '성별 비율',
        value: formatPublicMeetingGenderSummary(d.genderRatio, d.hostGenderSnapshot),
      },
      {
        icon: 'wallet-outline',
        label: '정산 방식',
        value: formatPublicMeetingSettlementSummary(d.settlement, d.membershipFeeWon),
      },
      {
        icon: 'ribbon-outline',
        label: '참가 레벨',
        value: `최소 Lv ${d.minGLevel}`,
      },
    ];
    if (typeof d.minGTrust === 'number') {
      rows.push({
        icon: 'shield-checkmark-outline',
        label: highTrust ? '신뢰도 (높은 모임)' : '최소 gTrust',
        value: highTrust
          ? `${d.minGTrust}점 이상 · 약속 이행이 검증된 멤버`
          : `${d.minGTrust}점 이상`,
        variant: highTrust ? 'trust' : 'default',
      });
    }
    rows.push({
      icon: 'checkmark-done-outline',
      label: '승인 방식',
      value: formatPublicMeetingApprovalSummary(d.approvalType),
    });
    return rows;
  }, [publicMeetingDetails]);

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

  const isHost = useMemo(() => (meeting ? isMeetingHost(userId, meeting.createdBy) : false), [meeting, userId]);

  const orderedParticipantIdsList = useMemo(() => (meeting ? orderedParticipantIds(meeting) : []), [meeting]);

  const sessionPk = useMemo(
    () => (userId?.trim() ? normalizeParticipantId(userId.trim()) : ''),
    [userId],
  );

  const alreadyJoinedMeeting = useMemo(() => {
    if (!sessionPk) return false;
    return orderedParticipantIdsList.includes(sessionPk);
  }, [sessionPk, orderedParticipantIdsList]);

  const proposeInitialPayload = useMemo((): VoteCandidatesPayload | null => {
    if (!meeting || !proposeOpen) return null;
    const dates = [
      createPointCandidate(
        newDateCandidateId(),
        insertModalSchedule.scheduleDate,
        insertModalSchedule.scheduleTime,
      ),
    ];
    const places: PlaceCandidate[] = meeting.placeCandidates?.length
      ? (meeting.placeCandidates.map((p) => ({ ...p })) as PlaceCandidate[])
      : [];
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
    // 관심지역(active feed region) 기준으로 최신 바이어스를 쓰도록 캐시를 비웁니다.
    invalidateNearbySearchBiasCache();
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
      setSelectedPlaceIds(additions.map((p, j) => placeCandidateChipId(p, existing.length + j)));
      setPlaceProposeOpen(false);
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : '장소 후보를 저장하지 못했습니다.');
    } finally {
      setPlaceProposeSaving(false);
    }
  }, [meeting, queryClient]);

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

  // 모임 상세 열람 게이트: 모임 이용 인증(약관+전화+성별/생년월일)이 완료되지 않으면 상세를 숨깁니다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionPk) {
        setMeetingAuthComplete(false);
        setMeetingAuthGateReady(true);
        return;
      }
      try {
        await ensureUserProfile(sessionPk);
        const p = await getUserProfile(sessionPk);
        const ok = isMeetingServiceComplianceComplete(p, sessionPk);
        if (!cancelled) {
          setMeetingAuthComplete(ok);
          setMeetingAuthGateReady(true);
        }
      } catch {
        if (!cancelled) {
          setMeetingAuthComplete(false);
          setMeetingAuthGateReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionPk]);

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
  }, [
    meeting,
    sessionPk,
    alreadyJoinedMeeting,
    isHost,
    meeting?.id,
    meeting?.scheduleConfirmed,
    appPoliciesVersion,
  ]);

  /** 게스트 참여 조건: 화면에 있는 각 투표 구역마다 최소 1개 선택 */
  const needsDatePick = dateChips.length > 0;
  const needsPlacePick = placeChips.length > 0;
  const needsMoviePick =
    (specialtyKind === 'movie' || extraMovies.length > 0) && extraMovies.length > 0;

  // 후보가 1개뿐이면 “투표”가 아니라 확정 내역처럼 고정 표시(자동 선택)합니다.
  const autoDatePick = needsDatePick && dateChips.length === 1;
  const autoPlacePick = needsPlacePick && placeChips.length === 1;
  const autoMoviePick = needsMoviePick && extraMovies.length === 1;

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

  // 게스트(미참여)에서 “참여 가능” 상태가 되면, 하단 버튼 영역을 밀지 않도록
  // 안내 문구는 배너(2초)로만 잠깐 노출합니다.
  const guestReadyBannerKeyRef = useRef<string>('');
  useEffect(() => {
    if (!meeting || !sessionPk || isHost) return;
    if (alreadyJoinedMeeting) return;
    if (!guestVotesReady) return;
    const key = `${meeting.id}\u0001${meeting.scheduleConfirmed === true ? 'confirmed' : 'ready'}`;
    if (guestReadyBannerKeyRef.current === key) return;
    guestReadyBannerKeyRef.current = key;
    showTransientBottomMessage(
      meeting.scheduleConfirmed === true
        ? '일정이 확정되었어요. 아래 참여를 눌러 주세요.'
        : '투표를 모두 골랐어요. 아래 참여를 눌러 주세요.',
      2000,
      74,
    );
  }, [meeting, sessionPk, isHost, alreadyJoinedMeeting, guestVotesReady]);

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

  const isParticipantGuest = Boolean(meeting && !isHost && alreadyJoinedMeeting && sessionPk);

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

    // 게스트(참여중)면 서버 스냅샷(정상 케이스)을 기준으로 삼고,
    // 호스트/신규 생성 모임(로그 없음)은 현재 선택 상태를 기준으로 둡니다.
    if (!isHost && alreadyJoinedMeeting && serverVoteFingerprint && serverVoteFingerprint !== 'legacy') {
      votesBaselineFpRef.current = serverVoteFingerprint;
      return;
    }

    const snap = getParticipantVoteSnapshot(meeting, sessionPk);
    if (snap) {
      votesBaselineFpRef.current = votesFingerprint({
        date: snap.dateChipIds,
        place: snap.placeChipIds,
        movie: snap.movieChipIds,
      });
      return;
    }

    votesBaselineFpRef.current = currentVotesFp;
  }, [
    meeting,
    sessionPk,
    isHost,
    alreadyJoinedMeeting,
    serverVoteFingerprint,
    currentVotesFp,
    votesFingerprint,
  ]);

  const votesDirty = useMemo(() => {
    void votePersistNonce;
    const base = votesBaselineFpRef.current;
    if (!base) return false;
    return base !== currentVotesFp;
  }, [currentVotesFp, votePersistNonce]);

  const proceedScreenBack = useCallback(() => {
    try {
      if (typeof (router as any)?.canGoBack === 'function' && (router as any).canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)');
      }
    } catch {
      router.replace('/(tabs)');
    }
  }, [router]);

  const safeBack = useCallback(() => {
    if (votesDirty && (isHost || alreadyJoinedMeeting)) {
      Alert.alert(
        '저장되지 않은 투표',
        '투표를 변경한 내역이 있어요. 저장을 누르지 않으면 반영되지 않아요.\n\n그래도 화면을 나갈까요?',
        [
          { text: '머무르기', style: 'cancel' },
          { text: '나가기', style: 'destructive', onPress: proceedScreenBack },
        ],
      );
      return;
    }
    proceedScreenBack();
  }, [votesDirty, isHost, alreadyJoinedMeeting, proceedScreenBack]);

  useEffect(() => {
    if (!meeting) return undefined;
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!votesDirty || !(isHost || alreadyJoinedMeeting)) return;
      e.preventDefault();
      Alert.alert(
        '저장되지 않은 투표',
        '투표를 변경한 내역이 있어요. 저장을 누르지 않으면 반영되지 않아요.\n\n그래도 화면을 나갈까요?',
        [
          { text: '머무르기', style: 'cancel' },
          {
            text: '나가기',
            style: 'destructive',
            onPress: () => {
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return unsub;
  }, [navigation, meeting, votesDirty, isHost, alreadyJoinedMeeting]);

  const hostTiePicks = useMemo(
    () => ({ dateChipId: hostTieDateId, placeChipId: hostTiePlaceId, movieChipId: hostTieMovieId }),
    [hostTieDateId, hostTiePlaceId, hostTieMovieId],
  );

  const participantGenderCounts = useMemo(() => {
    let male = 0;
    let female = 0;
    let unknown = 0;
    let missingProfile = 0;
    for (const userId of orderedParticipantIdsList) {
      const prof = participantProfiles[userId];
      if (!prof) {
        missingProfile += 1;
        continue;
      }
      const g = normalizeGender(prof.gender);
      if (g === 'male') male += 1;
      else if (g === 'female') female += 1;
      else unknown += 1;
    }
    return { male, female, unknown, missingProfile };
  }, [orderedParticipantIdsList, participantProfiles, normalizeGender]);

  const genderCountLabel = useMemo(() => {
    if (orderedParticipantIdsList.length === 0) return '';
    if (participantGenderCounts.missingProfile > 0) return '성별 집계 중…';
    // 성별 정보가 없는 참여자는 unknown으로 남기되, 남/여 집계는 실제 값만 표시
    const base = `남자 ${participantGenderCounts.male}명 · 여자 ${participantGenderCounts.female}명`;
    return participantGenderCounts.unknown > 0 ? `${base} · 미상 ${participantGenderCounts.unknown}명` : base;
  }, [orderedParticipantIdsList.length, participantGenderCounts]);

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

  const dateVoteByYmd = useMemo(() => {
    const list = meeting?.dateCandidates ?? [];
    const shown = new Set(dateChipsShown.map((c) => c.id));
    const by: Record<string, { chipId: string; hm: string; tally: number }[]> = {};
    list.forEach((dc, i) => {
      const ymd = typeof dc.startDate === 'string' ? dc.startDate.trim() : '';
      if (!ymd) return;
      const chipId = dateCandidateChipId(dc, i);
      if (!shown.has(chipId)) return;
      const hm = normalizeTimeInput(dc.startTime ?? '') || (dc.startTime?.trim() ?? '') || '15:00';
      const tally = meeting?.voteTallies?.dates?.[chipId] ?? 0;
      if (!by[ymd]) by[ymd] = [];
      by[ymd].push({ chipId, hm, tally });
    });
    Object.keys(by).forEach((k) => {
      const uniq = new Map<string, { chipId: string; hm: string; tally: number }>();
      by[k].forEach((x) => {
        const key = `${x.hm}|${x.chipId}`;
        if (!uniq.has(key)) uniq.set(key, x);
      });
      const rows = [...uniq.values()];
      rows.sort((a, b) => a.hm.localeCompare(b.hm));
      by[k] = rows;
    });
    return by;
  }, [dateChipsShown, meeting?.dateCandidates, meeting?.voteTallies?.dates]);

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
    const effectiveDateIds = autoDatePick && dateChips[0]?.id ? [dateChips[0].id] : selectedDateIds;
    const effectivePlaceIds = autoPlacePick && placeChips[0]?.id ? [placeChips[0].id] : selectedPlaceIds;
    const effectiveMovieIds = autoMoviePick && extraMovies[0] ? [movieCandidateChipId(extraMovies[0], 0)] : selectedMovieIds;
    if (!guestVotesReady) {
      const parts: string[] = [];
      if (needsDatePick && effectiveDateIds.length === 0) parts.push('일시');
      if (needsPlacePick && effectivePlaceIds.length === 0) parts.push('장소');
      if (needsMoviePick && effectiveMovieIds.length === 0) parts.push('영화');
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
      const profGate = await getUserProfile(sessionPk);
      if (meetingDemographicsIncomplete(profGate, sessionPk)) {
        Alert.alert(
          '프로필을 먼저 완성해 주세요',
          'SNS 간편 가입 계정은 프로필에서 성별과 연령대를 입력한 뒤 모임에 참여할 수 있어요.',
          [
            { text: '닫기', style: 'cancel' },
            { text: '정보 등록하기', onPress: () => pushProfileOpenRegisterInfo(router) },
          ],
        );
        return;
      }
      const joinVotes =
        meeting.scheduleConfirmed === true
          ? { dateChipIds: [] as string[], placeChipIds: [] as string[], movieChipIds: [] as string[] }
          : {
              dateChipIds: effectiveDateIds,
              placeChipIds: effectivePlaceIds,
              movieChipIds: effectiveMovieIds,
            };
      await joinMeeting(meeting.id, sessionPk, joinVotes);
      void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(meeting.id) });
      // 참여 직후에도 이 모임 상세에 머무름(구독 스냅샷으로 참여자 UI로 전환)
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
    meeting?.scheduleConfirmed,
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
  ]);

  useEffect(() => {
    if (placeChipsShown.length === 0) return;
    let alive = true;
    const visible = placeChipsShown.slice(0, 24);
    const t = setTimeout(() => {
      void (async () => {
        for (const chip of visible) {
          if (!alive) return;
          if (placeThumbByChipId[chip.id] !== undefined) continue;
          const q = `${chip.title} ${(chip.sub ?? '').trim()}`.trim();
          try {
            const thumb = await searchNaverImageThumbnail(q);
            if (!alive) return;
            setPlaceThumbByChipId((prev) => {
              if (prev[chip.id] !== undefined) return prev;
              return { ...prev, [chip.id]: thumb };
            });
          } catch {
            if (!alive) return;
            setPlaceThumbByChipId((prev) => {
              if (prev[chip.id] !== undefined) return prev;
              return { ...prev, [chip.id]: null };
            });
          }
        }
      })();
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeChipsShown]);

  /** 투표 선택을 서버에 반영(호스트/참여자 공통, 자동 저장에서 호출) */
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
      Alert.alert(
        '투표를 완료해 주세요',
        parts.length > 0
          ? `${parts.join(', ')}에서 최소 한 가지 이상 선택한 뒤 반영할 수 있어요.`
          : '각 투표에서 최소 한 가지 이상 선택한 뒤 반영할 수 있어요.',
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
      // 하단 버튼 영역을 가리지 않도록 오프셋을 둡니다.
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
  ]);

  // 투표는 하단 「저장」 버튼에서만 반영합니다(자동 저장 제거).
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

  const handleLeaveParticipant = useCallback(() => {
    if (!meeting || !sessionPk) {
      Alert.alert('안내', '로그인 후 탈퇴할 수 있어요.');
      return;
    }
    const confirmed = meeting.scheduleConfirmed === true;
    const penaltyCfg = confirmed
      ? getPolicy<{ xp?: number; trust?: number }>('trust', 'penalty_leave_confirmed', {
          xp: -30,
          trust: -12,
        })
      : null;
    const trustDrop =
      confirmed && penaltyCfg && typeof penaltyCfg.trust === 'number' && Number.isFinite(penaltyCfg.trust)
        ? Math.abs(Math.trunc(penaltyCfg.trust))
        : 12;
    const xpDrop =
      confirmed && penaltyCfg && typeof penaltyCfg.xp === 'number' && Number.isFinite(penaltyCfg.xp)
        ? Math.abs(Math.trunc(penaltyCfg.xp))
        : 30;
    const baseMsg =
      '참여를 취소하면 내가 넣었던 투표는 집계에서 빠져요. 다시 들어오려면 참여 절차가 필요해요.';
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
            setParticipantVoteBusy(true);
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
              router.replace('/(tabs)');
              if (penaltyLedgerOk) {
                if (Platform.OS === 'web') {
                  setTimeout(() => {
                    Alert.alert(
                      '신뢰 패널티가 반영됐어요',
                      `gTrust ${trustDrop}점·XP ${xpDrop}가 차감됐고, 누적 패널티가 1회 늘었어요.`,
                      [
                        { text: '닫기', style: 'cancel' },
                        { text: '프로필로', onPress: () => router.push('/(tabs)/profile') },
                      ],
                    );
                  }, 400);
                } else {
                  notifyTrustPenaltyAppliedFireAndForget({
                    trustPoints: trustDrop,
                    xpPoints: xpDrop,
                  });
                }
              }
            } catch (e) {
              Alert.alert('탈퇴 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
            } finally {
              setParticipantVoteBusy(false);
            }
          })();
        },
      },
    ]);
  }, [meeting, sessionPk, router, queryClient]);

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
                safeBack();
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
  }, [meeting, userId, safeBack, queryClient]);

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

  const viewBlockedByCompliance = meetingAuthGateReady && !meetingAuthComplete;

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.topBar}>
          <Pressable
            onPress={safeBack}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="뒤로">
            <Ionicons name="chevron-back" size={26} color={GinitTheme.colors.text} />
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
            <ActivityIndicator color={GinitTheme.colors.primary} />
            <Text style={styles.muted}>불러오는 중…</Text>
          </View>
        ) : null}

        {loadError ? (
          <View style={styles.centerFill}>
            <Text style={styles.errorTitle}>문제가 생겼어요</Text>
            <Text style={styles.muted}>{loadError}</Text>
            <Pressable
              onPress={() => {
                setRetryNonce((n) => n + 1);
                void refetchMeetingDetail();
              }}
              style={styles.retryBtn}
              accessibilityRole="button">
              <LinearGradient
                colors={GinitTheme.colors.ctaGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.btnGradientBg}
                pointerEvents="none"
              />
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : null}

        {viewBlockedByCompliance ? (
          <View style={styles.centerFill}>
            <Text style={styles.errorTitle}>프로필 인증이 필요해요</Text>
            <Text style={styles.muted}>
              모임 상세를 보려면 모임 이용을 위한 인증 정보 등록을 먼저 완료해 주세요.
            </Text>
            <Pressable
              onPress={() => pushProfileOpenRegisterInfo(router)}
              style={styles.retryBtn}
              accessibilityRole="button"
              accessibilityLabel="정보 등록하기">
              <LinearGradient
                colors={GinitTheme.colors.ctaGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.btnGradientBg}
                pointerEvents="none"
              />
              <Text style={styles.retryText}>정보 등록하기</Text>
            </Pressable>
          </View>
        ) : null}

        {notFound ? (
          <View style={styles.centerFill}>
            <Text style={styles.errorTitle}>모임을 찾을 수 없어요</Text>
            <Pressable onPress={safeBack} style={styles.retryBtn} accessibilityRole="button">
              <LinearGradient
                colors={GinitTheme.colors.ctaGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.btnGradientBg}
                pointerEvents="none"
              />
              <Text style={styles.retryText}>돌아가기</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !loadError && meeting !== null ? (
          <ScrollView
            ref={mainScrollRef}
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 96 + insets.bottom }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            <View style={styles.titleCard}>
              <Pressable style={styles.pencilAbs} accessibilityRole="button" accessibilityLabel="제목 수정">
                <Ionicons name="pencil" size={18} color={GinitTheme.colors.primary} />
              </Pressable>
              <Text style={styles.titleCardText}>{meeting.title || '제목 없음'}</Text>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoCardHead}>
                <LinearGradient
                  colors={['#86D3B7', '#73C7FF']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.infoCardHeadAccent}
                />
                <View style={styles.infoCardHeadText}>
                  <Text style={styles.infoCardTitle}>모임 등록 정보</Text>
                  <Text style={styles.infoCardKicker}>호스트가 남긴 모집 조건을 한눈에 확인해요</Text>
                </View>
              </View>

              <View style={styles.infoCategoryCard}>
                <View style={styles.infoCategoryIconWrap}>
                  <Ionicons name="pricetag-outline" size={20} color={GinitTheme.colors.primary} />
                </View>
                <View style={styles.infoCategoryTextCol}>
                  <Text style={styles.infoMetaLabel}>카테고리</Text>
                  <Text style={styles.infoMetaValue}>{meeting.categoryLabel?.trim() || '—'}</Text>
                </View>
              </View>

              <View style={styles.publicBadgeRow}>
                <View style={[styles.miniBadge, meeting.isPublic === false && styles.miniBadgeMuted]}>
                  <Ionicons
                    name={meeting.isPublic === false ? 'lock-closed-outline' : 'globe-outline'}
                    size={14}
                    color={meeting.isPublic === false ? '#64748B' : GinitTheme.colors.primary}
                    style={styles.miniBadgeIcon}
                  />
                  <Text style={[styles.miniBadgeText, meeting.isPublic === false && styles.miniBadgeTextMuted]}>
                    {meeting.isPublic === false ? '비공개' : '공개 모집'}
                  </Text>
                </View>
                <View style={styles.miniBadge}>
                  <Ionicons name="people-outline" size={14} color={GinitTheme.colors.primary} style={styles.miniBadgeIcon} />
                  <Text style={styles.miniBadgeText}>인원 {formatCapacityLine(meeting)}</Text>
                </View>
              </View>
              {representativeScheduleText ? (
                <View style={styles.scheduleHintRow}>
                  <Ionicons name="time-outline" size={16} color="#64748B" />
                  <Text style={[styles.infoRowMuted, styles.scheduleHintText]}>{representativeScheduleText}</Text>
                </View>
              ) : null}

              <View style={styles.infoDivider} />

              <Text style={styles.infoSectionLabelStrong}>소개</Text>
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

              <Text style={styles.infoSectionLabel}>현재 참여자</Text>
              {orderedParticipantIdsList.length > 0 ? (
                <View style={styles.publicBadgeRow}>
                  <View style={[styles.miniBadge, styles.miniBadgeMale]}>
                    <Text style={styles.miniBadgeMaleText}>남자 {participantGenderCounts.male}명</Text>
                  </View>
                  <View style={[styles.miniBadge, styles.miniBadgeFemale]}>
                    <Text style={styles.miniBadgeFemaleText}>여자 {participantGenderCounts.female}명</Text>
                  </View>
                  {participantGenderCounts.missingProfile > 0 ? (
                    <View style={[styles.miniBadge, styles.miniBadgeUnknown]}>
                      <Text style={styles.miniBadgeUnknownText}>미상 …</Text>
                    </View>
                  ) : (
                    <View style={[styles.miniBadge, styles.miniBadgeUnknown]}>
                      <Text style={styles.miniBadgeUnknownText}>미상 {participantGenderCounts.unknown}명</Text>
                    </View>
                  )}
                </View>
              ) : (
                <Text style={styles.infoRowMuted}>아직 참여한 사람이 없어요.</Text>
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
                    {(() => {
                      const detailUrl = resolveNaverPlaceDetailWebUrlLikeVoteChip({
                        naverPlaceLink: confirmedPlaceChipResolved.naverPlaceLink,
                        title: confirmedPlaceChipResolved.title,
                        addressLine: confirmedPlaceChipResolved.sub,
                      });
                      return detailUrl ? (
                        <Pressable
                          onPress={() =>
                            setNaverPlaceWebModal({
                              url: detailUrl,
                              title: confirmedPlaceChipResolved.title.trim() || '상세 정보',
                            })
                          }
                          style={({ pressed }) => [styles.placeNaverDetailBtn, pressed && { opacity: 0.88 }]}
                          accessibilityRole="button"
                          accessibilityLabel="상세 정보">
                          <Text style={styles.placeNaverDetailBtnText}>상세 정보</Text>
                        </Pressable>
                      ) : null;
                    })()}
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
                  <View style={styles.infoCard}>
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

            {dateChips.length === 1 ? (
              <>
                <Text style={styles.infoRow}>{dateChips[0].title}</Text>
                {dateChips[0].sub ? <Text style={styles.infoRowMuted}>{dateChips[0].sub}</Text> : null}
                <Text style={styles.dateSelectionHint}>후보가 1개라 자동으로 확정 내역처럼 표시돼요.</Text>
              </>
            ) : (
              <>
                {(() => {
                  const p = parseYmd(dateVoteCalendarMonth);
                  const base = p ? new Date(p.y, p.m - 1, 1) : new Date();
                  const year = base.getFullYear();
                  const month = base.getMonth();
                  const firstDow = new Date(year, month, 1).getDay();
                  const gridStart = new Date(year, month, 1 - firstDow);
                  const cells: { ymd: string; day: number; inMonth: boolean }[] = [];
                  for (let i = 0; i < 42; i += 1) {
                    const d = new Date(gridStart);
                    d.setDate(gridStart.getDate() + i);
                    cells.push({
                      ymd: fmtDateYmd(d),
                      day: d.getDate(),
                      inMonth: d.getMonth() === month,
                    });
                  }
                  const monthLabel = `${year}.${pad2(month + 1)}`;
                  return (
                    <View style={styles.voteCalendarWrap}>
                      <View style={styles.voteCalendarHeaderRow}>
                        <Pressable
                          onPress={() => {
                            const prev = new Date(year, month - 1, 1);
                            setDateVoteCalendarMonth(monthStartYmd(fmtDateYmd(prev)));
                          }}
                          style={({ pressed }) => [styles.calendarNavBtn, pressed && styles.calendarNavBtnPressed]}
                          accessibilityRole="button"
                          accessibilityLabel="이전 달">
                          <Ionicons name="chevron-back" size={18} color={GinitTheme.colors.primary} />
                        </Pressable>
                        <Text style={styles.voteCalendarTitle}>{monthLabel}</Text>
                        <Pressable
                          onPress={() => {
                            const next = new Date(year, month + 1, 1);
                            setDateVoteCalendarMonth(monthStartYmd(fmtDateYmd(next)));
                          }}
                          style={({ pressed }) => [styles.calendarNavBtn, pressed && styles.calendarNavBtnPressed]}
                          accessibilityRole="button"
                          accessibilityLabel="다음 달">
                          <Ionicons name="chevron-forward" size={18} color={GinitTheme.colors.primary} />
                        </Pressable>
                      </View>
                      <View style={styles.calendarDowRow}>
                        {WEEKDAY_KO.map((w) => (
                          <Text key={w} style={styles.calendarDowText}>
                            {w}
                          </Text>
                        ))}
                      </View>
                      <View style={styles.calendarGrid}>
                        {Array.from({ length: 6 }).map((_, wi) => {
                          const week = cells.slice(wi * 7, wi * 7 + 7);
                          const weekHasAny = week.some((c) => (dateVoteByYmd[c.ymd]?.length ?? 0) > 0);
                          return (
                            <View
                              key={`week-${wi}`}
                              style={[styles.calendarWeekRow, !weekHasAny && styles.calendarWeekRowEmpty, wi === 5 ? { marginBottom: 0 } : null]}>
                              {week.map((c) => {
                                const opts = dateVoteByYmd[c.ymd] ?? [];
                                const has = opts.length > 0;
                                const isHostSelected = has && opts.some((o) => hostTieDateId === o.chipId);
                                const isSelected = dateHostPickMode ? isHostSelected : opts.some((o) => selectedDateIds.includes(o.chipId));
                                const times = opts.map((o) => o.hm);
                                return (
                                  <Pressable
                                    key={c.ymd}
                                    onPress={() => {
                                      if (!has) return;
                                      if (opts.length === 1) {
                                        onDateChipPress(opts[0].chipId);
                                        return;
                                      }
                                      setDateVoteTimePick({ ymd: c.ymd });
                                    }}
                                    style={({ pressed }) => [
                                      styles.calendarCell,
                                      !weekHasAny && styles.calendarCellRowEmpty,
                                      !c.inMonth && styles.calendarCellOut,
                                      has && styles.calendarCellHas,
                                      isSelected && styles.calendarCellSelected,
                                      pressed && styles.calendarCellPressed,
                                    ]}
                                    accessibilityRole={dateHostPickMode ? 'radio' : 'button'}
                                    accessibilityLabel={`${c.ymd}${has ? ` ${opts.length}개` : ''}`}>
                                    <Text style={[styles.calendarCellDay, !c.inMonth && styles.calendarCellDayOut]}>{c.day}</Text>
                                    {has ? (
                                      <View style={styles.calendarTimesWrap} pointerEvents="none">
                                        {times.map((t) => (
                                          <Text key={`${c.ymd}-${t}`} style={styles.calendarCellMeta}>
                                            {t}
                                          </Text>
                                        ))}
                                      </View>
                                    ) : (
                                      <Text style={styles.calendarCellMetaEmpty}>{' '}</Text>
                                    )}
                                  </Pressable>
                                );
                              })}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })()}
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
              </>
            )}

            <Pressable
              style={({ pressed }) => [styles.addOutlineBtn, pressed && styles.dateChipPressed]}
              accessibilityRole="button"
              accessibilityLabel="날짜 제안"
              onPress={openDateProposeModal}>
              <Ionicons name="calendar-outline" size={20} color={GinitTheme.colors.primary} />
              <Text style={styles.addOutlineTextActive}>날짜 제안</Text>
            </Pressable>
                  </View>
            </View>

            {(specialtyKind === 'movie' || extraMovies.length > 0) && (
              <View
                collapsable={false}
                onLayout={(e) => {
                  voteSectionScrollYs.current.movie = e.nativeEvent.layout.y;
                }}>
                <View style={styles.infoCard}>
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
                {extraMovies.length === 1 ? (
                  <>
                    <View style={styles.confirmedMovieRow}>
                      {extraMovies[0].posterUrl?.trim() ? (
                        <Image
                          source={{ uri: extraMovies[0].posterUrl.trim() }}
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
                          {extraMovies[0].title}
                          {extraMovies[0].year ? ` (${extraMovies[0].year})` : ''}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.dateSelectionHint}>후보가 1개라 자동으로 확정 내역처럼 표시돼요.</Text>
                  </>
                ) : extraMovies.length > 0 ? (
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
                              styles.moviePosterThumbWrap,
                              chipSelected && styles.moviePosterThumbWrapSelected,
                              pressed && styles.moviePosterThumbWrapPressed,
                            ]}
                            accessibilityRole={movieHostPickMode ? 'radio' : 'checkbox'}
                            accessibilityState={{ checked: chipSelected, selected: chipSelected }}
                            accessibilityLabel={`${mv.title}${chipSelected ? ', 선택됨' : ', 선택 안 됨'}`}>
                            {mv.posterUrl?.trim() ? (
                              <Image
                                source={{ uri: mv.posterUrl.trim() }}
                                style={styles.moviePosterThumb}
                                contentFit="cover"
                                transition={120}
                              />
                            ) : (
                              <View style={[styles.moviePosterThumb, styles.moviePosterPlaceholder]}>
                                <Ionicons name="film-outline" size={22} color="#94A3B8" />
                              </View>
                            )}
                            <View style={[styles.voteTallyBadge, styles.voteTallyBadgeMoviePoster]} pointerEvents="none">
                              <Text style={styles.voteTallyBadgeText}>{tally}</Text>
                            </View>
                            {chipSelected ? (
                              <View style={styles.moviePosterThumbCheck} pointerEvents="none">
                                <Ionicons name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                              </View>
                            ) : null}
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
              </View>
            )}

            <View
              collapsable={false}
              onLayout={(e) => {
                voteSectionScrollYs.current.place = e.nativeEvent.layout.y;
              }}>
              <View style={styles.infoCard}>
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
            {placeChips.length === 1 ? (
              <>
                <Text style={styles.infoRow}>{placeChips[0].title}</Text>
                {placeChips[0].sub ? <Text style={styles.infoRowMuted}>{placeChips[0].sub}</Text> : null}
                <Pressable
                  onPress={() => openPlaceVoteDetailWeb(placeChips[0])}
                  style={({ pressed }) => [styles.placeNaverDetailBtn, pressed && { opacity: 0.88 }]}
                  accessibilityRole="button"
                  accessibilityLabel="가게 정보">
                  <Text style={styles.placeNaverDetailBtnText}>가게 정보</Text>
                </Pressable>
                <Text style={styles.dateSelectionHint}>후보가 1개라 자동으로 확정 내역처럼 표시돼요.</Text>
                {singlePlaceCoords ? (
                  <View style={styles.confirmedMapPress}>
                    <View style={styles.confirmedMapPreviewBox}>
                      <GooglePlacePreviewMap
                        latitude={singlePlaceCoords.latitude}
                        longitude={singlePlaceCoords.longitude}
                        height={200}
                        borderRadius={12}
                      />
                      <Pressable
                        onPress={() => {
                          const name = placeChips[0]?.title?.trim();
                          void openNaverMapAt(singlePlaceCoords.latitude, singlePlaceCoords.longitude, name).then((ok) => {
                            if (!ok) Alert.alert('안내', '네이버 지도를 열 수 없어요.');
                          });
                        }}
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
                ) : null}
              </>
            ) : placeChips.length > 0 ? (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.placeVoteCarouselContent}>
                  {placeChipsShown.map((chip) => {
                    const chipSelected = placeHostPickMode
                      ? hostTiePlaceId === chip.id
                      : selectedPlaceIds.includes(chip.id);
                    const tally = meeting.voteTallies?.places?.[chip.id] ?? 0;
                    const thumb = placeThumbByChipId[chip.id] ?? null;
                    return (
                      <View
                        key={chip.id}
                        style={[styles.placeVoteCard, chipSelected ? styles.placeVoteCardSelected : null]}>
                        <Pressable
                          onPress={() => onPlaceChipPress(chip.id)}
                          style={({ pressed }) => [pressed ? styles.dateChipPressed : null]}
                          accessibilityRole={placeHostPickMode ? 'radio' : 'checkbox'}
                          accessibilityState={{ checked: chipSelected, selected: chipSelected }}
                          accessibilityLabel={`${chip.title}${chip.sub ? ` ${chip.sub}` : ''}${chipSelected ? ', 선택됨' : ', 선택 안 됨'}`}>
                          <View style={styles.placeVoteImageWrap}>
                            {thumb ? (
                              <Image source={{ uri: thumb }} style={styles.placeVoteImage} contentFit="cover" />
                            ) : (
                              <View style={styles.placeVoteImageFallback} />
                            )}
                            <View style={styles.placeVoteTallyBadge} pointerEvents="none">
                              <Text style={styles.voteTallyBadgeText}>{tally}</Text>
                            </View>
                            {chipSelected ? (
                              <View style={styles.placeVoteSelectedOverlay} pointerEvents="none">
                                <Ionicons name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.placeVoteTitle} numberOfLines={2}>
                            {chip.title}
                          </Text>
                          {chip.sub ? (
                            <Text style={styles.placeVoteSub} numberOfLines={2}>
                              {chip.sub}
                            </Text>
                          ) : null}
                        </Pressable>
                        <Pressable
                          onPress={() => openPlaceVoteDetailWeb(chip)}
                          style={({ pressed }) => [styles.placeVoteDetailLink, pressed && { opacity: 0.88 }]}
                          accessibilityRole="button"
                          accessibilityLabel="가게 정보">
                          <Text style={styles.placeVoteDetailLinkText}>가게 정보</Text>
                        </Pressable>
                      </View>
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
            

            <Pressable
              style={({ pressed }) => [styles.addOutlineBtn, pressed && styles.dateChipPressed]}
              accessibilityRole="button"
              accessibilityLabel="장소 제안"
              onPress={openPlaceProposeModal}>
              <Ionicons name="location-outline" size={20} color={GinitTheme.colors.primary} />
              <Text style={styles.addOutlineTextActive}>장소 제안</Text>
            </Pressable>
              </View>
                </View>
              </>
            )}

            {publicMeetingDetails && publicConditionRows.length > 0 ? (
              <View style={styles.infoCard}>
                <View style={styles.dateVoteHeaderBlock}>
                  <Text style={[styles.sectionTitle, styles.sectionSpacedTight]}>상세 조건</Text>
                  <Text style={styles.dateVoteSub}>참여 전 꼭 확인해 주세요</Text>
                </View>
                <View style={styles.conditionsInsetWrap}>
                  <View style={styles.conditionsList}>
                    {publicConditionRows.map((row, idx) => {
                      const isTrust = row.variant === 'trust';
                      const isLast = idx === publicConditionRows.length - 1;
                      return (
                        <View
                          key={`${row.label}-${idx}`}
                          style={[
                            styles.condRow,
                            !isLast && styles.condRowBorder,
                            isTrust && styles.condRowTrust,
                          ]}>
                          <View style={[styles.condIconWrap, isTrust && styles.condIconWrapTrust]}>
                            <Ionicons name={row.icon} size={19} color={isTrust ? '#9a3412' : '#0f172a'} />
                          </View>
                          <View style={styles.condTextCol}>
                            <Text style={[styles.condLabel, isTrust && styles.condLabelTrust]}>{row.label}</Text>
                            <Text style={[styles.condValue, isTrust && styles.condValueTrust]}>{row.value}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
                {publicMeetingDetails.approvalType === 'HOST_APPROVAL' &&
                publicMeetingDetails.requestMessageEnabled === true ? (
                  <View style={styles.condCallout}>
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color="#0369a1" />
                    <Text style={styles.condCalloutText}>참가 신청 시 호스트가 한 줄 메시지를 받아요.</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.infoCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>참여자 ({orderedParticipantIdsList.length}명)</Text>
                {genderCountLabel ? <Text style={styles.genderCountText}>{genderCountLabel}</Text> : null}
              </View>
              {orderedParticipantIdsList.length === 0 ? (
                <Text style={styles.infoRowMuted}>아직 참여한 사람이 없어요.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.avatarRow}>
                  {orderedParticipantIdsList.map((userId) => {
                    const prof = participantProfiles[userId];
                    const withdrawn = isUserProfileWithdrawn(prof);
                    const nickname = withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname ?? '…');
                    const g = withdrawn ? null : normalizeGender(prof?.gender);
                    const hostPk = meeting.createdBy?.trim()
                      ? normalizeParticipantId(meeting.createdBy)
                      : '';
                    const isHostUser = Boolean(hostPk && hostPk === userId);
                    const photo = withdrawn ? '' : (prof?.photoUrl?.trim() ?? '');
                    return (
                      <Pressable
                        key={userId}
                        onPress={() => openParticipantProfile(userId)}
                        style={({ pressed }) => [styles.avatarCol, pressed && !withdrawn && { opacity: 0.92 }]}
                        pointerEvents={withdrawn ? 'none' : 'auto'}
                        accessibilityRole="button"
                        accessibilityLabel={`${nickname} 프로필 열기`}>
                        <View
                          style={[
                            styles.avatarCircle,
                            withdrawn ? styles.avatarCircleWithdrawn : null,
                            !withdrawn && g === 'male' ? styles.avatarCircleMale : null,
                            !withdrawn && g === 'female' ? styles.avatarCircleFemale : null,
                          ]}>
                          {withdrawn ? (
                            <Ionicons name="person" size={22} color="#94a3b8" />
                          ) : photo ? (
                            <Image source={{ uri: photo }} style={styles.avatarPhoto} contentFit="cover" />
                          ) : (
                            <Text style={styles.avatarInitial}>{nicknameInitial(nickname)}</Text>
                          )}
                        </View>
                        <Text style={styles.avatarLabel} numberOfLines={2}>
                          {isHostUser ? `${nickname}\n(호스트)` : nickname}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {recruitmentPhase === 'recruiting' ? (
                    <Pressable style={styles.avatarAdd} accessibilityRole="button" accessibilityLabel="참여자 초대">
                      <Ionicons name="add" size={26} color={GinitTheme.colors.primary} />
                    </Pressable>
                  ) : null}
                </ScrollView>
              )}
            </View>
          </ScrollView>
        ) : null}

        {/* 게스트 안내 문구는 배너로만 표시(버튼 영역 침범 방지) */}

        {!loading && !loadError && meeting !== null ? (
          <View style={[styles.bottomBar, { paddingBottom: 12 + insets.bottom }]}>
            {isHost ? (
              <View style={styles.bottomBarCol}>
                <View style={styles.bottomBarEqualRow}>
                  {recruitmentPhase === 'recruiting' ? (
                    <>
                      <Pressable
                        style={[styles.bottomPill, styles.pillBlue, styles.bottomPillFlex]}
                        accessibilityRole="button"
                        accessibilityLabel="초대">
                        <Ionicons name="mail-outline" size={18} color="#fff" />
                        <Text style={[styles.pillText, styles.bottomPillLabel]} numberOfLines={1} ellipsizeMode="tail">
                          초대
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => router.push(`/meeting-chat/${meeting.id}`)}
                        style={[styles.bottomPill, styles.pillBlue, styles.bottomPillFlex]}
                        accessibilityRole="button"
                        accessibilityLabel="모임 채팅">
                        <Ionicons name="chatbubbles-outline" size={18} color="#fff" />
                        <Text style={[styles.pillText, styles.bottomPillLabel]} numberOfLines={1} ellipsizeMode="tail">
                          채팅
                        </Text>
                      </Pressable>
                    </>
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

                  {orderedParticipantIdsList.length >= 2 ? (
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
                      accessibilityLabel={meeting.scheduleConfirmed === true ? '일정 확정 취소' : '모집 일정 확정'}>
                      {confirmScheduleBusy ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Ionicons
                          name={meeting.scheduleConfirmed === true ? 'close-circle-outline' : 'checkmark-circle'}
                          size={18}
                          color={meeting.scheduleConfirmed === true ? '#fff' : GinitTheme.colors.text}
                        />
                      )}
                      <Text
                        style={[
                          styles.pillText,
                          meeting.scheduleConfirmed === true ? null : styles.pillTextOnOrange,
                          styles.bottomPillLabel,
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail">
                        {meeting.scheduleConfirmed === true ? '취소' : '확정'}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={onPressSaveVotes}
                    style={({ pressed }) => [
                      styles.bottomPill,
                      styles.pillBlue,
                      styles.bottomPillFlex,
                      participantVoteBusy && { opacity: 0.75 },
                      pressed && !participantVoteBusy && { opacity: 0.9 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="저장">
                    {participantVoteBusy ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Ionicons name="save-outline" size={18} color="#fff" />
                    )}
                    <Text style={[styles.pillText, styles.bottomPillLabel]} numberOfLines={1} ellipsizeMode="tail">
                      저장
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : alreadyJoinedMeeting ? (
              <View style={styles.bottomBarCol}>
                <View style={styles.bottomBarEqualRow}>
                  {recruitmentPhase === 'recruiting' ? (
                    <>
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
                      <Pressable
                        onPress={() => router.push(`/meeting-chat/${meeting.id}`)}
                        style={[styles.bottomPill, styles.pillBlue, styles.bottomPillFlex]}
                        accessibilityRole="button"
                        accessibilityLabel="모임 채팅">
                        <Ionicons name="chatbubbles-outline" size={16} color="#fff" />
                        <Text
                          style={[styles.pillText, styles.pillTextCompact, styles.bottomPillLabel]}
                          numberOfLines={1}
                          ellipsizeMode="tail">
                          채팅
                        </Text>
                      </Pressable>
                    </>
                  ) : null}
                  <Pressable
                    onPress={onPressSaveVotes}
                    style={({ pressed }) => [
                      styles.bottomPill,
                      styles.pillBlue,
                      styles.bottomPillFlex,
                      participantVoteBusy && { opacity: 0.75 },
                      pressed && !participantVoteBusy && { opacity: 0.9 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="저장">
                    {participantVoteBusy ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Ionicons name="save-outline" size={16} color="#fff" />
                    )}
                    <Text
                      style={[styles.pillText, styles.pillTextCompact, styles.bottomPillLabel]}
                      numberOfLines={1}
                      ellipsizeMode="tail">
                      저장
                    </Text>
                  </Pressable>
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
                    accessibilityLabel="퇴장">
                    <Ionicons name="exit-outline" size={16} color="#fff" />
                    <Text
                      style={[styles.pillText, styles.pillTextCompact, styles.bottomPillLabel]}
                      numberOfLines={1}
                      ellipsizeMode="tail">
                      퇴장
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.guestJoinBottomCol}>
                <View style={styles.bottomBarEqualRow}>
                  <Pressable
                    onPress={() => {
                      if (joinBusy) {
                        Alert.alert('안내', '처리 중이에요. 잠시만 기다려 주세요.');
                        return;
                      }
                      if (joinScheduleOverlapBlock) {
                        Alert.alert(
                          '일정 겹침',
                          `이미 확정된 다른 모임과 시간이 겹칠 수 있어요. (겹침 방지 ${joinOverlapBufferHours}시간)`,
                        );
                        return;
                      }
                      void handleJoinMeeting();
                    }}
                    style={({ pressed }) => [
                      styles.joinCtaBtn,
                      styles.bottomPillFlex,
                      joinBusy && { opacity: 0.75 },
                      pressed && !joinBusy && { opacity: 0.9 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="모임 참여">
                    <LinearGradient
                      colors={GinitTheme.colors.ctaGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.joinCtaBg}
                      pointerEvents="none"
                    />
                    <View style={styles.joinCtaInner} pointerEvents="none">
                      {joinBusy ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Ionicons name="hand-right-outline" size={18} color="#fff" />
                      )}
                      <Text style={styles.joinCtaLabel} numberOfLines={1} ellipsizeMode="tail">
                        참여
                      </Text>
                    </View>
                  </Pressable>
                </View>
                {joinScheduleOverlapBlock ? (
                  <Text style={styles.joinOverlapCaption}>
                    기존 약속과 시간이 겹쳐 참여가 어렵습니다. ({joinOverlapBufferHours}시간 이내)
                  </Text>
                ) : null}
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
            style={styles.proposeModalRoot}>
            <Pressable
              style={styles.proposeModalBackdrop}
              onPress={() => !proposeSaving && setProposeOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="닫기"
            />
            <View
              style={[
                styles.proposeModalSheet,
                styles.proposeModalSheetDateCompact,
                {
                  maxHeight: Math.round(
                    Math.min(windowHeight * 0.86, windowHeight - 56),
                  ),
                },
              ]}>
              <View style={styles.proposeModalHeaderRow}>
                <View style={styles.proposeModalIconWrap} accessibilityElementsHidden>
                  <Ionicons name="calendar-outline" size={22} color={GinitTheme.colors.primary} />
                </View>
                <View style={styles.proposeModalHeaderTextCol}>
                  <Text style={styles.proposeModalTitle}>날짜 제안</Text>
                </View>
              </View>
              
              {proposeInitialPayload ? (
                <KeyboardAwareScreenScroll
                  style={[
                    styles.proposeModalFormScroll,
                    styles.proposeModalFormScrollDate,
                    { maxHeight: Math.round(windowHeight * 0.62) },
                  ]}
                  contentContainerStyle={[
                    styles.proposeModalFormScrollContent,
                    styles.proposeModalFormScrollContentDateCompact,
                  ]}
                  extraScrollHeight={10}
                  extraHeight={28}
                  scrollProps={{
                    nestedScrollEnabled: true,
                    showsVerticalScrollIndicator: false,
                  }}>
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
                </KeyboardAwareScreenScroll>
              ) : null}
              <View style={[styles.proposeModalFooter, styles.proposeModalFooterDateCompact]}>
                <Pressable
                  onPress={() => !proposeSaving && setProposeOpen(false)}
                  style={({ pressed }) => [styles.proposeModalGhostBtn, pressed && styles.dateChipPressed]}
                  accessibilityRole="button">
                  <Text style={styles.proposeModalGhostBtnText}>취소</Text>
                </Pressable>
                <Pressable
                  onPress={() => void confirmDateProposals()}
                  disabled={proposeSaving}
                  style={({ pressed }) => [
                    styles.proposeModalPrimaryBtn,
                    (pressed || proposeSaving) && { opacity: proposeSaving ? 0.7 : 0.9 },
                  ]}
                  accessibilityRole="button">
                  <LinearGradient
                    colors={GinitTheme.colors.ctaGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.btnGradientBg}
                    pointerEvents="none"
                  />
                  {proposeSaving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.proposeModalPrimaryBtnText}>후보 추가</Text>
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
            style={styles.proposeModalRoot}>
            <Pressable
              style={styles.proposeModalBackdrop}
              onPress={() => !placeProposeSaving && setPlaceProposeOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="닫기"
            />
            <View style={[styles.proposeModalSheet, { maxHeight: Math.round(windowHeight * 0.72) }]}>
              <View style={styles.proposeModalHeaderRow}>
                <View style={styles.proposeModalIconWrap} accessibilityElementsHidden>
                  <Ionicons name="location-outline" size={22} color={GinitTheme.colors.primary} />
                </View>
                <View style={styles.proposeModalHeaderTextCol}>
                  <Text style={styles.proposeModalTitle}>장소 제안</Text>
                </View>
              </View>
    
              {placeProposeInitialPayload ? (
                <KeyboardAwareScreenScroll
                  style={styles.proposeModalFormScroll}
                  contentContainerStyle={styles.proposeModalFormScrollContent}
                  extraScrollHeight={22}
                  extraHeight={56}
                  scrollProps={{
                    nestedScrollEnabled: true,
                    showsVerticalScrollIndicator: false,
                  }}>
                  <VoteCandidatesForm
                    key={placeProposeFormKey}
                    ref={placeVoteFormRef}
                    seedPlaceQuery=""
                    seedScheduleDate={insertModalSchedule.scheduleDate}
                    seedScheduleTime={insertModalSchedule.scheduleTime}
                    initialPayload={placeProposeInitialPayload}
                    bare
                    wizardSegment="places"
                    onNaverPlaceWebOpen={(url, title) => setNaverPlaceWebModal({ url, title })}
                  />
                </KeyboardAwareScreenScroll>
              ) : null}
              <View style={styles.proposeModalFooter}>
                <Pressable
                  onPress={() => !placeProposeSaving && setPlaceProposeOpen(false)}
                  style={({ pressed }) => [styles.proposeModalGhostBtn, pressed && styles.dateChipPressed]}
                  accessibilityRole="button">
                  <Text style={styles.proposeModalGhostBtnText}>취소</Text>
                </Pressable>
                <Pressable
                  onPress={() => void confirmPlaceProposals()}
                  disabled={placeProposeSaving}
                  style={({ pressed }) => [
                    styles.proposeModalPrimaryBtn,
                    (pressed || placeProposeSaving) && { opacity: placeProposeSaving ? 0.7 : 0.9 },
                  ]}
                  accessibilityRole="button">
                  <LinearGradient
                    colors={GinitTheme.colors.ctaGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.btnGradientBg}
                    pointerEvents="none"
                  />
                  {placeProposeSaving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.proposeModalPrimaryBtnText}>후보 추가</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {dateVoteTimePick ? (
          <Modal
            visible
            animationType="fade"
            transparent
            onRequestClose={() => setDateVoteTimePick(null)}>
            <View style={styles.proposeModalRoot}>
              <Pressable
                style={styles.proposeModalBackdrop}
                onPress={() => setDateVoteTimePick(null)}
                accessibilityRole="button"
                accessibilityLabel="닫기"
              />
              <View style={[styles.proposeModalSheet, { maxHeight: Math.round(windowHeight * 0.6) }]}>
                <View style={styles.proposeModalHeaderRow}>
                  <View style={styles.proposeModalIconWrap} accessibilityElementsHidden>
                    <Ionicons name="time-outline" size={22} color={GinitTheme.colors.primary} />
                  </View>
                  <View style={styles.proposeModalHeaderTextCol}>
                    <Text style={styles.proposeModalTitle}>시간 선택</Text>
                    <Text style={styles.proposeModalSubDateCompact}>{dateVoteTimePick.ymd}</Text>
                  </View>
                </View>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 12 }}>
                  {(dateVoteByYmd[dateVoteTimePick.ymd] ?? []).map((o) => {
                    const selected = dateHostPickMode ? hostTieDateId === o.chipId : selectedDateIds.includes(o.chipId);
                    return (
                      <Pressable
                        key={o.chipId}
                        onPress={() => onDateChipPress(o.chipId)}
                        style={({ pressed }) => [
                          styles.dateChip,
                          styles.candidateChipV,
                          selected ? styles.dateChipSelected : null,
                          pressed ? styles.dateChipPressed : null,
                        ]}
                        accessibilityRole={dateHostPickMode ? 'radio' : 'checkbox'}
                        accessibilityState={{ checked: selected, selected }}
                        accessibilityLabel={`${o.hm}${selected ? ', 선택됨' : ''}`}>
                        <View style={styles.voteTallyBadge} pointerEvents="none">
                          <Text style={styles.voteTallyBadgeText}>{o.tally}</Text>
                        </View>
                        {selected ? (
                          <View style={styles.dateChipCheckWrapLeft} pointerEvents="none">
                            <Ionicons name="checkmark-circle" size={20} color={GinitTheme.colors.primary} />
                          </View>
                        ) : null}
                        <Text style={[styles.dateChipTitle, styles.dateChipTitleV]} numberOfLines={1}>
                          {o.hm}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <View style={styles.proposeModalFooterDateCompact}>
                  <Pressable
                    onPress={() => setDateVoteTimePick(null)}
                    style={({ pressed }) => [styles.proposeModalGhostBtn, pressed && styles.dateChipPressed]}
                    accessibilityRole="button">
                    <Text style={styles.proposeModalGhostBtnText}>닫기</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        <Modal
          visible={profilePopupUserId != null}
          animationType="fade"
          transparent
          onRequestClose={closeParticipantProfile}>
          <View style={styles.profileModalRoot}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeParticipantProfile}
              accessibilityRole="button"
              accessibilityLabel="프로필 닫기"
            />
            <View style={styles.profileModalCard}>
              {(() => {
                const pid = profilePopupUserId?.trim() ?? '';
                const prof = pid ? participantProfiles[pid] : undefined;
                const withdrawn = isUserProfileWithdrawn(prof);
                const isLoading = Boolean(pid) && prof == null;
                const nick = withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname?.trim() ?? '회원');
                const photo = withdrawn ? '' : (prof?.photoUrl?.trim() ?? '');
                const trust = typeof prof?.gTrust === 'number' ? prof.gTrust : null;
                const dna = withdrawn ? '' : (prof?.gDna?.trim() ?? '');
                const isMe =
                  Boolean(userId?.trim() && pid) && normalizeParticipantId(userId ?? '') === normalizeParticipantId(pid);
                const gender = withdrawn ? '' : (prof?.gender?.trim() ?? '');
                const ageBand = withdrawn ? '' : (prof?.ageBand?.trim() ?? '');
                const metaParts = [
                  trust != null ? `gTrust ${trust}` : 'gTrust —',
                  dna ? dna : '',
                  [ageBand, gender].filter(Boolean).join(' · '),
                ].filter(Boolean);
                const friendGinitDisabled =
                  friendRequestBusy ||
                  withdrawn ||
                  isMe ||
                  friendRelation.status === 'accepted' ||
                  friendRelation.status === 'pending_out';
                const friendLabel =
                  friendRelation.status === 'accepted'
                    ? '친구'
                    : friendRelation.status === 'pending_out'
                      ? '신청 중'
                      : friendRelation.status === 'pending_in'
                        ? '친구 요청 수락'
                        : '친구 요청';
                const friendIconName: keyof typeof Ionicons.glyphMap =
                  friendRelation.status === 'accepted'
                    ? 'checkmark-circle'
                    : friendRelation.status === 'pending_out'
                      ? 'time'
                      : friendRelation.status === 'pending_in'
                        ? 'checkmark-done'
                        : 'person-add';
                const friendInMissingId =
                  friendRelation.status === 'pending_in' && !friendRelation.friendship_id?.trim();
                return (
                  <>
                    <View style={styles.profileModalTop}>
                      <View style={styles.profileAvatarWrap}>
                        {photo ? (
                          <Image source={{ uri: photo }} style={styles.profileAvatarImg} contentFit="cover" />
                        ) : (
                          <View style={styles.profileAvatarFallback}>
                            <Text style={styles.profileAvatarLetter}>{nicknameInitial(nick)}</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.profileModalTopText}>
                        <Text style={styles.profileModalNick} numberOfLines={1}>
                          {nick}
                        </Text>
                        <Text style={styles.profileModalMeta} numberOfLines={1}>
                          {isLoading ? '프로필 불러오는 중…' : metaParts.join(' · ')}
                        </Text>
                      </View>
                      <Pressable
                        onPress={closeParticipantProfile}
                        style={({ pressed }) => [styles.profileModalCloseBtn, pressed && { opacity: 0.9 }]}
                        accessibilityRole="button"
                        accessibilityLabel="닫기">
                        <Ionicons name="close" size={18} color={GinitTheme.colors.textMuted} />
                      </Pressable>
                    </View>

                    <View style={styles.profileModalActions}>
                      {isMe ? (
                        <Pressable
                          disabled
                          style={[styles.profileActionBtn, styles.profileActionPrimary, { opacity: 0.65 }]}
                          accessibilityRole="button"
                          accessibilityLabel="내 프로필">
                          <Ionicons name="person" size={16} color="#fff" />
                          <Text style={styles.profileActionPrimaryText}>내 프로필</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={
                            friendRelation.status === 'pending_in' ? onAcceptFriendGinit : onSendFriendGinit
                          }
                          disabled={
                            (friendGinitDisabled && friendRelation.status !== 'pending_in') || friendInMissingId
                          }
                          style={({ pressed }) => [
                            styles.profileActionBtn,
                            styles.profileActionPrimary,
                            ((friendGinitDisabled && friendRelation.status !== 'pending_in') || friendInMissingId) && {
                              opacity: 0.55,
                            },
                            pressed &&
                              !(
                                (friendGinitDisabled && friendRelation.status !== 'pending_in') ||
                                friendInMissingId
                              ) && { opacity: 0.9 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={friendLabel}>
                          {friendRequestBusy ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Ionicons name={friendIconName} size={16} color="#fff" />
                          )}
                          <Text style={styles.profileActionPrimaryText} numberOfLines={1}>
                            {friendLabel}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </>
                );
              })()}
            </View>
          </View>
        </Modal>

        <NaverPlaceWebViewModal
          visible={naverPlaceWebModal != null}
          url={naverPlaceWebModal?.url}
          pageTitle={naverPlaceWebModal?.title ?? '상세 정보'}
          onClose={() => setNaverPlaceWebModal(null)}
        />
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
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
  topTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: GinitTheme.colors.text, textAlign: 'center' },
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
    backgroundColor: 'transparent',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
  },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 12 },
  joinCtaBtn: {
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: GinitTheme.glass.borderLight,
    shadowColor: GinitTheme.glass.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 22,
    elevation: 14,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  joinCtaBg: {
    ...StyleSheet.absoluteFillObject,
  },
  joinCtaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  joinCtaLabel: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.35,
  },
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
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    shadowColor: 'rgba(15, 23, 42, 0.1)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 4,
  },
  infoCardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  infoCardHeadAccent: { width: 5, height: 44, borderRadius: 3 },
  infoCardHeadText: { flex: 1, minWidth: 0 },
  infoCardTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a', letterSpacing: -0.3 },
  infoCardKicker: { marginTop: 4, fontSize: 12, fontWeight: '600', color: '#64748b', lineHeight: 17 },
  infoCategoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(248, 250, 252, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  infoCategoryIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(134, 211, 183, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCategoryTextCol: { flex: 1, minWidth: 0 },
  infoMetaLabel: { fontSize: 11, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6 },
  infoMetaValue: { marginTop: 4, fontSize: 16, fontWeight: '800', color: '#0f172a', letterSpacing: -0.2 },
  scheduleHintRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  infoDivider: {
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    marginTop: 14,
    marginBottom: 4,
    borderRadius: 2,
  },
  infoSectionLabelStrong: {
    fontSize: 11,
    fontWeight: '900',
    color: '#64748b',
    letterSpacing: 0.8,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  infoLabel: { fontWeight: '700', color: '#64748B' },
  infoRow: { fontSize: 14, color: '#1A1A1A', lineHeight: 21 },
  infoRowMuted: { fontSize: 13, color: '#64748b', lineHeight: 19 },
  scheduleHintText: { flex: 1 },
  infoSectionLabel: { fontSize: 12, fontWeight: '700', color: '#8B95A1', marginTop: 10 },
  infoDescription: { fontSize: 14, color: '#334155', lineHeight: 22, marginTop: 6 },
  /** 상세 조건 본문 — `모임 등록 정보`의 카테고리 카드와 동일 톤으로 투표·참여자 카드와 맞춤 */
  conditionsInsetWrap: {
    borderRadius: 14,
    padding: 10,
    backgroundColor: 'rgba(248, 250, 252, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  conditionsList: {
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    overflow: 'hidden',
  },
  condRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12 },
  condRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: 'rgba(15, 23, 42, 0.06)' },
  condRowTrust: {
    backgroundColor: 'rgba(255, 237, 213, 0.55)',
  },
  condIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(241, 245, 249, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  condIconWrapTrust: {
    backgroundColor: 'rgba(255, 247, 237, 0.98)',
    borderColor: 'rgba(251, 146, 60, 0.35)',
  },
  condTextCol: { flex: 1, minWidth: 0 },
  condLabel: { fontSize: 11, fontWeight: '800', color: '#64748b', letterSpacing: 0.4, textTransform: 'uppercase' },
  condLabelTrust: { color: '#9a3412' },
  condValue: { marginTop: 4, fontSize: 15, fontWeight: '800', color: '#0f172a', lineHeight: 21, letterSpacing: -0.2 },
  condValueTrust: { color: '#7c2d12' },
  condCallout: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(224, 242, 254, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  condCalloutText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#0c4a6e', lineHeight: 19 },
  publicBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  miniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 82, 204, 0.1)',
  },
  miniBadgeIcon: { marginTop: 0 },
  miniBadgeMuted: { backgroundColor: '#F1F5F9' },
  miniBadgeText: { fontSize: 12, fontWeight: '700', color: GinitTheme.colors.primary },
  miniBadgeTextMuted: { color: '#64748B' },
  miniBadgeMale: { backgroundColor: 'rgba(115, 199, 255, 0.18)' },
  miniBadgeMaleText: { fontSize: 12, fontWeight: '800', color: '#0369A1' },
  miniBadgeFemale: { backgroundColor: 'rgba(255, 140, 198, 0.16)' },
  miniBadgeFemaleText: { fontSize: 12, fontWeight: '800', color: '#BE185D' },
  miniBadgeUnknown: { backgroundColor: 'rgba(100, 116, 139, 0.14)' },
  miniBadgeUnknownText: { fontSize: 12, fontWeight: '800', color: '#475569' },
  movieScrollContent: { flexDirection: 'row', gap: 12, paddingVertical: 4, paddingRight: 8 },
  moviePosterThumbWrap: {
    width: 108,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E4E9EF',
    backgroundColor: '#fff',
    overflow: 'hidden',
    position: 'relative',
  },
  moviePosterThumbWrapSelected: {
    borderColor: GinitTheme.colors.primary,
  },
  moviePosterThumbWrapPressed: { opacity: 0.9 },
  moviePosterThumb: { width: '100%', height: 148, backgroundColor: '#E2E8F0' },
  moviePosterThumbCheck: { position: 'absolute', top: 6, left: 6, zIndex: 4 },
  voteTallyBadgeMoviePoster: { top: 6, right: 6 },
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
  movieVoteCardV: {
    width: '100%',
    padding: 10,
  },
  movieRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  movieRowTextCol: { flex: 1, minWidth: 0 },
  moviePosterTitleV: { marginTop: 0, fontSize: 13, lineHeight: 18 },
  movieVoteCardSelected: {
    borderColor: GinitTheme.colors.primary,
    backgroundColor: 'rgba(0, 82, 204, 0.07)',
  },
  movieVoteCheckWrapLeft: { position: 'absolute', top: 5, left: 4, zIndex: 5 },
  moviePoster: { width: 100, height: 148, borderRadius: 10, backgroundColor: '#E2E8F0', alignSelf: 'center' },
  moviePosterPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  moviePosterTitle: { fontSize: 12, fontWeight: '600', color: '#334155', marginTop: 8, lineHeight: 16 },
  moviePosterTitleSelected: { color: GinitTheme.colors.primary },
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
  /** 장소검색 인라인 미리보기와 동일 — 지도 위 탭 시 네이버 지도 앱/웹으로 연결 */
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
  voteCalendarWrap: {
    width: '100%',
    marginTop: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    overflow: 'hidden',
  },
  voteCalendarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  voteCalendarTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    letterSpacing: -0.2,
  },
  calendarNavBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  calendarNavBtnPressed: { opacity: 0.9 },
  calendarDowRow: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 8, paddingBottom: 6 },
  calendarDowText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '800',
    color: GinitTheme.colors.textMuted,
  },
  calendarGrid: { paddingHorizontal: 8, paddingBottom: 10 },
  calendarWeekRow: { flexDirection: 'row', width: '100%', marginBottom: 8 },
  calendarWeekRowEmpty: { marginBottom: 2 },
  calendarCell: {
    flexGrow: 1,
    flexBasis: 0,
    paddingHorizontal: 4,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: 12,
  },
  calendarCellRowEmpty: { paddingVertical: 2, minHeight: 18 },
  calendarCellOut: { opacity: 0.42 },
  calendarCellHas: {
    backgroundColor: 'rgba(0, 82, 204, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(0, 82, 204, 0.18)',
  },
  /** 날짜 제안(`VoteCandidatesForm`) 달력 `calendarCellHas` 톤 + 장소 후보 선택과 동일한 민트 강조 */
  calendarCellSelected: {
    borderWidth: 1,
    borderColor: 'rgba(134, 211, 183, 0.9)',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  calendarCellPressed: { opacity: 0.9 },
  calendarCellDay: { fontSize: 13, fontWeight: '900', color: GinitTheme.colors.text, lineHeight: 18 },
  calendarCellDayOut: { color: GinitTheme.colors.textMuted },
  calendarTimesWrap: { alignItems: 'center', justifyContent: 'center' },
  calendarCellMeta: { marginTop: 2, fontSize: 10, fontWeight: '800', color: GinitTheme.colors.primary },
  calendarCellMetaEmpty: { marginTop: 2, fontSize: 10, color: 'transparent' },
  placeVoteCarouselContent: { flexDirection: 'row', gap: 10, paddingBottom: 6, paddingRight: 8 },
  /** `VoteCandidatesForm` 장소 검색 카드(`placeResultCard` + `placeResultImageCard`)와 동일 톤 */
  placeVoteCard: {
    width: 176,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
    position: 'relative',
    overflow: 'visible',
    shadowColor: 'rgba(15, 23, 42, 0.06)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  placeVoteCardSelected: {
    borderColor: 'rgba(134, 211, 183, 0.9)',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  placeVoteImageWrap: {
    width: '100%',
    height: 112,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  placeVoteImage: { width: '100%', height: '100%' },
  placeVoteImageFallback: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.06)' },
  placeVoteSelectedOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderRadius: 999,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  placeVoteTallyBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 6,
    minWidth: 27,
    height: 25,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderWidth: 1,
    borderColor: 'rgba(0, 82, 204, 0.12)',
    shadowColor: 'rgba(15, 23, 42, 0.12)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 3,
  },
  placeVoteTitle: { fontSize: 13, fontWeight: '900', color: GinitTheme.colors.text, lineHeight: 18, marginBottom: 6 },
  placeVoteSub: { fontSize: 11, fontWeight: '700', color: GinitTheme.colors.textMuted, lineHeight: 15 },
  placeVoteDetailLink: {
    marginTop: 8,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: GinitTheme.radius.button,
    borderWidth: 1,
    borderColor: GinitTheme.colors.primary,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
  },
  placeVoteDetailLinkText: {
    fontSize: 11,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
  },
  placeNaverDetailBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: GinitTheme.radius.button,
    borderWidth: 1,
    borderColor: GinitTheme.colors.primary,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  placeNaverDetailBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
  },
  candidateListV: { gap: 10, paddingBottom: 6 },
  candidateChipV: {
    alignSelf: 'stretch',
    width: '100%',
    minWidth: undefined,
    maxWidth: undefined,
    paddingRight: 14,
  },
  dateChipTitleV: { textAlign: 'left' },
  dateChipSubV: { textAlign: 'left' },
  /** 일시 투표 시간 선택 시트 — 장소 제안 후보 카드(`placeResultCard`)와 동일 톤 */
  dateChip: {
    minWidth: 112,
    maxWidth: 140,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    position: 'relative',
    overflow: 'visible',
    shadowColor: 'rgba(15, 23, 42, 0.06)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  dateChipSelected: {
    borderColor: 'rgba(134, 211, 183, 0.9)',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
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
    color: GinitTheme.colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  },
  dateChipTitle: { fontSize: 14, fontWeight: '700', color: GinitTheme.colors.text, textAlign: 'center' },
  dateChipSub: { fontSize: 13, fontWeight: '600', color: '#5C6570', textAlign: 'center', marginTop: 6 },
  dateChipSubSelected: { color: GinitTheme.colors.primary },
  dateSelectionHint: { fontSize: 13, color: GinitTheme.colors.primary, fontWeight: '600', marginTop: 8 },
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
  addOutlineTextActive: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.primary },
  /** 날짜·장소 제안 모달 — 상세 화면 카드(밝은 서피스)와 동일 톤 */
  proposeModalRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  proposeModalBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
  },
  proposeModalSheet: {
    zIndex: 2,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderRadius: 20,
    padding: 18,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    ...GinitTheme.shadow.card,
  },
  /** 날짜 제안만 — 시트 패딩·전체 높이를 줄여 한 화면에 맞춤 */
  proposeModalSheetDateCompact: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  proposeModalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  proposeModalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 82, 204, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  proposeModalHeaderTextCol: { flex: 1, minWidth: 0 },
  proposeModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: GinitTheme.colors.text,
  },
  proposeModalSub: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    lineHeight: 19,
    marginBottom: 10,
  },
  proposeModalSubDateCompact: {
    marginBottom: 4,
    fontSize: 12,
    lineHeight: 17,
  },
  proposeModalFormScroll: { flexGrow: 0 },
  /** 날짜 제안: flex는 인라인 maxHeight(화면 비율)로 스크롤 영역 상한만 둠 */
  proposeModalFormScrollDate: {
    flexGrow: 0,
  },
  proposeModalFormScrollContent: { paddingBottom: 12 },
  proposeModalFormScrollContentDateCompact: {
    paddingBottom: 4,
    flexGrow: 0,
  },
  proposeModalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    marginTop: 5,
    paddingTop: 14,
//    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GinitTheme.colors.border,
  },
  proposeModalFooterDateCompact: {
    marginTop: 6,
    paddingTop: 6,
  },
  proposeModalGhostBtn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GinitTheme.colors.borderStrong,
    backgroundColor: GinitTheme.colors.bg,
  },
  proposeModalGhostBtnText: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.textSub },
  proposeModalPrimaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 14,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    borderWidth: 0,
    minWidth: 124,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGradientBg: {
    ...StyleSheet.absoluteFillObject,
  },
  proposeModalPrimaryBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
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
  pencilPlaceRowText: { fontSize: 14, fontWeight: '600', color: GinitTheme.colors.primary },
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
  avatarCircleMale: {
    borderColor: 'rgba(115, 199, 255, 0.95)',
  },
  avatarCircleFemale: {
    borderColor: 'rgba(255, 140, 198, 0.95)',
  },
  avatarCircleWithdrawn: {
    backgroundColor: '#e2e8f0',
    borderColor: '#cbd5e1',
  },
  avatarPhoto: { width: 52, height: 52, borderRadius: 26 },
  avatarInitial: { fontSize: 18, fontWeight: '700', color: GinitTheme.colors.primary },
  avatarLabel: { marginTop: 6, fontSize: 11, color: '#333', textAlign: 'center', lineHeight: 14 },
  genderCountText: { fontSize: 12, fontWeight: '700', color: GinitTheme.colors.textMuted },
  avatarAdd: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
    opacity: 0.85,
  },
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
    color: GinitTheme.colors.primary,
    lineHeight: 17,
    textAlign: 'center',
    fontWeight: '600',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    backgroundColor: 'transparent',
  },
  guestJoinBottomCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    alignItems: 'stretch',
  },
  joinOverlapCaption: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 14,
    paddingHorizontal: 4,
  },
  /** 보이는 버튼만큼 동일 비율(flex 1)로 화면 너비 분배 */
  bottomBarEqualRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    minWidth: 0,
  },
  bottomBarCol: {
    width: '100%',
    gap: 10,
  },
  bottomPillLabel: {
    flexShrink: 1,
    // 버튼 폭이 좁을 때(특히 2~3개 버튼 배치) 라벨이 0으로 줄어 "글자가 사라지는" 케이스 방지
    minWidth: 26,
    textAlign: 'center',
  },
  bottomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 50,
    borderRadius: 22,
  },
  /** 게스트 2버튼일 때 가로 폭 균등 */
  bottomPillFlex: { flex: 1, minWidth: 0 },
  pillBlue: { backgroundColor: GinitTheme.colors.primary },
  pillOrange: { backgroundColor: GinitTheme.pointOrange },
  pillDanger: { backgroundColor: '#DC2626' },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 14, lineHeight: 18 },
  pillTextOnOrange: { color: GinitTheme.colors.text },
  pillTextCompact: { fontSize: 12, lineHeight: 16 },

  profileModalRoot: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  profileModalCard: {
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    padding: 18,
    ...GinitTheme.shadow.card,
  },
  profileModalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileAvatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: 'rgba(226, 232, 240, 0.8)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  profileAvatarImg: { width: '100%', height: '100%' },
  profileAvatarFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  profileAvatarLetter: { fontSize: 20, fontWeight: '900', color: GinitTheme.colors.primary },
  profileModalTopText: { flex: 1, minWidth: 0, gap: 4 },
  profileModalNick: { fontSize: 18, fontWeight: '900', color: GinitTheme.colors.text, letterSpacing: -0.2 },
  profileModalMeta: { fontSize: 13, fontWeight: '700', color: GinitTheme.colors.textMuted },
  profileModalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  profileModalActions: { marginTop: 14 },
  profileActionBtn: {
    height: 44,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  profileActionPrimary: { backgroundColor: GinitTheme.colors.primary },
  profileActionPrimaryText: { fontSize: 15, fontWeight: '900', color: '#fff' },
});
