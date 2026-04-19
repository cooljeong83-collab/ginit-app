import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { VoteCandidatesForm, type VoteCandidatesFormHandle } from '@/app/create/details';
import { CAPACITY_UNLIMITED } from '@/components/create/GlassDualCapacityWheel';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { resolveSpecialtyKind, type SpecialtyKind } from '@/src/lib/category-specialty';
import { createPointCandidate, fmtDateYmd, normalizeTimeInput } from '@/src/lib/date-candidate';
import type { DateCandidate, VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import type { MeetingExtraData, SelectedMovieExtra, SportIntensityLevel } from '@/src/lib/meeting-extra-data';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingById, updateMeetingDateCandidates } from '@/src/lib/meetings';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

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

const MOCK_PARTICIPANTS = [
  { id: '1', label: 'Sarah\n(호스트)', initial: 'S' },
  { id: '2', label: 'Alex', initial: 'A' },
  { id: '3', label: 'Maria', initial: 'M' },
  { id: '4', label: 'Chris', initial: 'C' },
  { id: '5', label: 'Ken', initial: 'K' },
] as const;

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

  const load = useCallback(async () => {
    if (!id?.trim()) {
      setMeeting(null);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setLoading(true);
    try {
      const m = await getMeetingById(id);
      setMeeting(m);
    } catch (e) {
      setMeeting(null);
      setLoadError(e instanceof Error ? e.message : '불러오기에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedDateIds([]);
    setSelectedPlaceIds([]);
    setSelectedMovieIds([]);
  }, [meeting?.id]);

  const storedDateCandidates = meeting?.dateCandidates ?? [];
  const dateChips = useMemo(() => {
    if (!meeting) return [];
    const list = meeting.dateCandidates ?? [];
    return buildDateChipsFromCandidates(list);
  }, [meeting]);

  const placeChips = useMemo(() => (meeting ? buildPlaceChipsFromMeeting(meeting) : []), [meeting]);

  const specialtyKind = useMemo(() => (meeting ? getExtraDataSpecialtyKind(meeting) : null), [meeting]);
  const extraMovies = useMemo(() => (meeting ? extractMoviesFromExtra(meeting.extraData) : []), [meeting?.extraData]);
  const extraMenus = useMemo(() => (meeting ? extractMenuPreferences(meeting.extraData) : []), [meeting?.extraData]);
  const extraSport = useMemo(() => (meeting ? extractSportIntensity(meeting.extraData) : null), [meeting?.extraData]);

  const representativeScheduleText = useMemo(() => {
    if (!meeting) return null;
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

  const openDateProposeModal = useCallback(() => {
    setProposeFormKey((k) => k + 1);
    setProposeOpen(true);
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
          <View style={styles.badgeOrange}>
            <Text style={styles.badgeOrangeText}>투표 진행 중</Text>
          </View>
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
            <Pressable onPress={() => void load()} style={styles.retryBtn} accessibilityRole="button">
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

              {(specialtyKind === 'movie' || extraMovies.length > 0) && (
                <>
                  <Text style={styles.infoSectionLabel}>영화 후보 (투표)</Text>
                  <Text style={styles.dateVoteSub}>포스터를 눌러 보고 싶은 작품을 여러 개 선택할 수 있어요.</Text>
                  {extraMovies.length > 0 ? (
                    <>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.movieScrollContent}>
                        {extraMovies.map((mv, mi) => {
                          const chipId = movieCandidateChipId(mv, mi);
                          const selected = selectedMovieIds.includes(chipId);
                          return (
                            <Pressable
                              key={chipId}
                              onPress={() => toggleMovieSelection(chipId)}
                              style={({ pressed }) => [
                                styles.movieVoteCard,
                                selected ? styles.movieVoteCardSelected : null,
                                pressed ? styles.dateChipPressed : null,
                              ]}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: selected }}
                              accessibilityLabel={`${mv.title}${selected ? ', 선택됨' : ', 선택 안 됨'}`}>
                              {selected ? (
                                <View style={styles.movieVoteCheckWrap} pointerEvents="none">
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
                              <Text style={[styles.moviePosterTitle, selected && styles.moviePosterTitleSelected]} numberOfLines={2}>
                                {mv.title}
                                {mv.year ? ` (${mv.year})` : ''}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                      <Text style={selectedMovieIds.length > 0 ? styles.dateSelectionHint : styles.dateSelectionHintMuted}>
                        {selectedMovieIds.length > 0
                          ? `${selectedMovieIds.length}편 선택됨`
                          : '아직 선택한 영화가 없어요'}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.infoRowMuted}>등록된 영화 후보가 없어요.</Text>
                  )}
                </>
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

            <View style={styles.dateVoteHeaderBlock}>
              <Text style={styles.sectionTitle}>
                일시 투표 ({storedDateCandidates.length > 0 ? storedDateCandidates.length : dateChips.length}건)
              </Text>
              <Text style={styles.dateVoteSub}>가능한 날짜를 가로로 스크롤하며 여러 개 선택할 수 있어요.</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateChipScroll}>
              {dateChips.map((chip) => {
                const selected = selectedDateIds.includes(chip.id);
                return (
                  <Pressable
                    key={chip.id}
                    onPress={() => toggleDateSelection(chip.id)}
                    style={({ pressed }) => [
                      styles.dateChip,
                      selected ? styles.dateChipSelected : null,
                      pressed ? styles.dateChipPressed : null,
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${chip.title}${chip.sub ? ` ${chip.sub}` : ''}${selected ? ', 선택됨' : ', 선택 안 됨'}`}>
                    {selected ? (
                      <View style={styles.dateChipCheckWrap} pointerEvents="none">
                        <Ionicons name="checkmark-circle" size={20} color={GinitTheme.trustBlue} />
                      </View>
                    ) : null}
                    <Text style={[styles.dateChipTitle, selected && styles.dateChipTitleSelected]} numberOfLines={2}>
                      {chip.title}
                    </Text>
                    {chip.sub ? (
                      <Text style={[styles.dateChipSub, selected && styles.dateChipSubSelected]} numberOfLines={1}>
                        {chip.sub}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={selectedDateIds.length > 0 ? styles.dateSelectionHint : styles.dateSelectionHintMuted}>
              {selectedDateIds.length > 0 ? `${selectedDateIds.length}개 선택됨` : '아직 선택한 일정이 없어요'}
            </Text>

            <Pressable
              style={({ pressed }) => [styles.addOutlineBtn, pressed && styles.dateChipPressed]}
              accessibilityRole="button"
              accessibilityLabel="날짜 제안"
              onPress={openDateProposeModal}>
              <Ionicons name="calendar-outline" size={20} color={GinitTheme.trustBlue} />
              <Text style={styles.addOutlineTextActive}>날짜 제안</Text>
            </Pressable>

            <View style={styles.dateVoteHeaderBlock}>
              <Text style={[styles.sectionTitle, styles.sectionSpacedTight]}>
                장소 투표 ({placeChips.length > 0 ? placeChips.length : 0}건)
              </Text>
              <Text style={styles.dateVoteSub}>가능한 장소를 가로로 스크롤하며 여러 개 선택할 수 있어요.</Text>
            </View>
            {placeChips.length > 0 ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateChipScroll}>
                  {placeChips.map((chip) => {
                    const selected = selectedPlaceIds.includes(chip.id);
                    return (
                      <Pressable
                        key={chip.id}
                        onPress={() => togglePlaceSelection(chip.id)}
                        style={({ pressed }) => [
                          styles.dateChip,
                          styles.placeVoteChip,
                          selected ? styles.dateChipSelected : null,
                          pressed ? styles.dateChipPressed : null,
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        accessibilityLabel={`${chip.title}${chip.sub ? ` ${chip.sub}` : ''}${selected ? ', 선택됨' : ', 선택 안 됨'}`}>
                        {selected ? (
                          <View style={styles.dateChipCheckWrap} pointerEvents="none">
                            <Ionicons name="checkmark-circle" size={20} color={GinitTheme.trustBlue} />
                          </View>
                        ) : null}
                        <Text style={[styles.dateChipTitle, selected && styles.dateChipTitleSelected]} numberOfLines={2}>
                          {chip.title}
                        </Text>
                        {chip.sub ? (
                          <Text style={[styles.dateChipSub, selected && styles.dateChipSubSelected]} numberOfLines={2}>
                            {chip.sub}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Text style={selectedPlaceIds.length > 0 ? styles.dateSelectionHint : styles.dateSelectionHintMuted}>
                  {selectedPlaceIds.length > 0 ? `${selectedPlaceIds.length}개 선택됨` : '아직 선택한 장소가 없어요'}
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

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>참여자 (5명)</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.avatarRow}>
              {MOCK_PARTICIPANTS.map((p) => (
                <View key={p.id} style={styles.avatarCol}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarInitial}>{p.initial}</Text>
                  </View>
                  <Text style={styles.avatarLabel} numberOfLines={2}>
                    {p.label.includes('\n') ? (
                      <>
                        {p.label.split('\n')[0]}
                        {'\n'}
                        {p.label.split('\n')[1]}
                      </>
                    ) : (
                      p.label
                    )}
                  </Text>
                </View>
              ))}
              <Pressable style={styles.avatarAdd} accessibilityRole="button" accessibilityLabel="참여자 초대">
                <Ionicons name="add" size={26} color={GinitTheme.trustBlue} />
              </Pressable>
            </ScrollView>

            <View style={styles.bottomSpacer} />
          </ScrollView>
        ) : null}

        {!loading && !loadError && meeting !== null ? (
          <View style={styles.bottomBar}>
            {isHost ? (
              <>
                <Pressable style={[styles.bottomPill, styles.pillBlue]} accessibilityRole="button" accessibilityLabel="모임 수정">
                  <Ionicons name="construct-outline" size={18} color="#fff" />
                  <Text style={styles.pillText}>수정</Text>
                </Pressable>
                <Pressable style={[styles.bottomPill, styles.pillBlue]} accessibilityRole="button" accessibilityLabel="초대">
                  <Ionicons name="mail-outline" size={18} color="#fff" />
                  <Text style={styles.pillText}>초대</Text>
                </Pressable>
                <Pressable style={[styles.bottomPill, styles.pillOrange]} accessibilityRole="button" accessibilityLabel="일정 확정">
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.pillText}>확정</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  style={[styles.bottomPill, styles.pillBlue, styles.bottomPillFlex]}
                  accessibilityRole="button"
                  accessibilityLabel="초대">
                  <Ionicons name="mail-outline" size={18} color="#fff" />
                  <Text style={styles.pillText}>초대</Text>
                </Pressable>
                <Pressable
                  style={[styles.bottomPill, styles.pillOrange, styles.bottomPillFlex]}
                  accessibilityRole="button"
                  accessibilityLabel="모임 참여">
                  <Ionicons name="hand-right-outline" size={18} color="#fff" />
                  <Text style={styles.pillText}>참여</Text>
                </Pressable>
              </>
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
  badgeOrange: {
    backgroundColor: GinitTheme.pointOrange,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 4,
  },
  badgeOrangeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
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
  movieVoteCheckWrap: { position: 'absolute', top: 8, right: 8, zIndex: 2 },
  moviePoster: { width: 100, height: 148, borderRadius: 10, backgroundColor: '#E2E8F0', alignSelf: 'center' },
  moviePosterPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  moviePosterTitle: { fontSize: 12, fontWeight: '600', color: '#334155', marginTop: 8, lineHeight: 16 },
  moviePosterTitleSelected: { color: GinitTheme.trustBlue },
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
  dateChipCheckWrap: { position: 'absolute', top: 6, right: 6 },
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
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: 'rgba(0,0,0,0.1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
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
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingBottom: 20,
    backgroundColor: 'transparent',
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
  pillText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
