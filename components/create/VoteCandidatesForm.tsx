/**
 * 일정·장소 투표 후보 편집 폼 — 원본: `app/create/details.tsx`에서 분리.
 */


import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateCandidateEditorCard, type DatePickerField } from '@/components/create/DateCandidateEditorCard';
import { PlaceCandidateDetailLinkRow } from '@/components/create/PlaceCandidateDetailLinkRow';
import { voteCandidatesFormStyles as styles } from '@/components/create/vote-candidates-form-styles';
import type {
  MeetingCreatePlacesAutoAssistSnapshot,
  VoteCandidatesBuildResult,
  VoteCandidatesFormHandle,
  VoteCandidatesFormProps,
  VoteCandidatesGateResult,
} from '@/components/create/vote-candidates-form.types';
import { NaverPlaceWebViewModal } from '@/components/NaverPlaceWebViewModal';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { GinitTheme } from '@/constants/ginit-theme';
import { GinitStyles } from '@/constants/GinitStyles';
import { useUserSession } from '@/src/context/UserSessionContext';
import { layoutAnimateMeetingCreateWizard } from '@/src/lib/android-layout-animation';
import type { SpecialtyKind } from '@/src/lib/category-specialty';
import {
  coerceDateCandidate,
  createPointCandidate,
  fmtDateYmd,
  maxSelectableScheduleDayStartLocal,
  maxSelectableScheduleYmdLocal,
  validateDateCandidate,
} from '@/src/lib/date-candidate';
import { deferSoftInputUntilUserTapProps } from '@/src/lib/defer-soft-input-until-user-tap';
import { stripUndefinedDeep } from '@/src/lib/firestore-utils';
import {
  resolvePlaceSearchRowCoordinates,
  searchPlacesText,
  stableNaverLocalSearchDedupeKey,
  type PlaceSearchRow,
} from '@/src/lib/naver-local-place-search-text';
import {
  buildInitialEditorState,
  clampHm,
  dateFromYmd,
  defaultScheduleTimePlus3Hours,
  emptyPlaceRow,
  fmtDate,
  fmtTime,
  forcePointCandidate,
  getPickerDraft,
  humanizeSpeechRecognitionError,
  isFilled,
  monthStartYmd,
  type PlaceRowModel,
  newId,
  pad2,
  parseDateTimeStrings,
  pickerFieldLabel,
  placeRowFromCandidate,
  pickRandomUniqueSlots,
  upcomingWeekendSlotPool,
  weekendAnytimeMatches,
  WEEKEND_ANYTIME_PREVIEW_COUNT,
} from '@/src/lib/meeting-create-vote-candidates-utils';
import type { DateCandidate, PlaceCandidate, VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import { consumePendingVotePlaceRow } from '@/src/lib/meeting-place-bridge';
import {
  assertDateCandidatesNoOverlapWithOtherMeetings,
  DATE_CANDIDATE_OVERLAP_BUFFER_HOURS,
  GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION,
} from '@/src/lib/meeting-schedule-overlap';
import { parseSmartNaturalSchedule, type SmartNlpResult } from '@/src/lib/natural-language-schedule';
import { searchNaverPlaceImageThumbnail } from '@/src/lib/naver-image-search';
import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';
import { ensureNearbySearchBias } from '@/src/lib/nearby-search-bias';
import { computeNlpApply, dateCandidateDupKey } from '@/src/lib/nlp-schedule-candidates';
import {
  buildDefaultPlaceSearchQuery,
  buildPlaceSuggestedSearchQueries,
} from '@/src/lib/place-query-builder';

type DateTimePickerEvent = Parameters<NonNullable<ComponentProps<typeof DateTimePicker>['onChange']>>[0];

/** 레거시 스펙 상수(점진 제거) — 시안 톤 토큰으로 치환 */
const INPUT_PLACEHOLDER = '#94a3b8';
/** Kakao 로컬 키워드 검색 — 한 페이지 최대 15건 중 앱에서 5건 사용 */
const PLACE_SEARCH_PAGE_SIZE = 5;
/** 인라인 장소 검색: 표시·선택 상한(조회 결과가 많아도 카드는 최대 이 개수만) */
const INLINE_PLACE_PICK_MAX_SELECTED = 5;
const DEFAULT_CALENDAR_PICK_TIME = '19:00';
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;
/** 가로 달력 월 스와이프 전환 중에만 가운데 그리드 opacity를 낮춘 뒤 1로 복귀 */
const CALENDAR_MONTH_SWIPE_TRANSITION_OPACITY = 0.76;

function animate() {
  layoutAnimateMeetingCreateWizard();
}

export function VoiceWaveform({ active, color }: { active: boolean; color: string }) {
  const v1 = useRef(new Animated.Value(0)).current;
  const v2 = useRef(new Animated.Value(0)).current;
  const v3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const mk = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 260, useNativeDriver: true }),
        ]),
      );
    const l1 = mk(v1, 0);
    const l2 = mk(v2, 90);
    const l3 = mk(v3, 180);
    l1.start();
    l2.start();
    l3.start();
    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
      v1.setValue(0);
      v2.setValue(0);
      v3.setValue(0);
    };
  }, [active, v1, v2, v3]);

  if (!active) return null;

  const barStyle = (v: Animated.Value) => ({
    transform: [
      {
        scaleY: v.interpolate({
          inputRange: [0, 1],
          outputRange: [0.35, 1.0],
        }),
      },
    ],
  });

  return (
    <View style={styles.voiceWaveWrap} pointerEvents="none">
      <Animated.View style={[styles.voiceWaveBar, { backgroundColor: color }, barStyle(v1)]} />
      <Animated.View style={[styles.voiceWaveBar, { backgroundColor: color }, barStyle(v2)]} />
      <Animated.View style={[styles.voiceWaveBar, { backgroundColor: color }, barStyle(v3)]} />
    </View>
  );
}

export function VoteCandidateCard({
  reduceHeavyEffects,
  children,
  outerStyle,
  wrapStyleOverride,
}: {
  reduceHeavyEffects: boolean;
  children: ReactNode;
  outerStyle?: StyleProp<ViewStyle>;
  wrapStyleOverride?: StyleProp<ViewStyle>;
}) {
  const flat = StyleSheet.flatten(outerStyle) as ViewStyle | undefined;
  const {
    margin,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    marginHorizontal,
    marginVertical,
    alignSelf,
    borderRadius,
    ...innerRest
  } = flat ?? {};

  const wrapStyle: StyleProp<ViewStyle> = [
    styles.glassCardWrap,
    wrapStyleOverride,
    (margin != null ||
      marginTop != null ||
      marginBottom != null ||
      marginLeft != null ||
      marginRight != null ||
      marginHorizontal != null ||
      marginVertical != null ||
      alignSelf != null) && {
      margin,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
      marginHorizontal,
      marginVertical,
      alignSelf,
    },
    borderRadius != null && { borderRadius },
  ];

  const innerStyle: StyleProp<ViewStyle> = [
    styles.glassCardInner,
    borderRadius != null && { borderRadius },
    innerRest,
  ];

  if (reduceHeavyEffects || Platform.OS === 'web') {
    return (
      <View style={wrapStyle}>
        <View style={innerStyle}>{children}</View>
      </View>
    );
  }

  return (
    <View style={wrapStyle}>
      <BlurView
        tint="light"
        intensity={GinitTheme.glassModal.blurIntensity}
        style={innerStyle}
        experimentalBlurMethod="dimezisBlurView">
        {children}
      </BlurView>
    </View>
  );
}

export const VoteCandidatesForm = forwardRef<VoteCandidatesFormHandle, VoteCandidatesFormProps>(function VoteCandidatesForm(
  {
    seedPlaceQuery = '',
    seedScheduleDate,
    seedScheduleTime,
    placeThemeLabel = '',
    placeThemeSpecialtyKind = null,
    placeMenuPreferenceLabels = undefined,
    placeThemeMajorCode = undefined,
    placeActivityKindLabels = undefined,
    placeGameKindLabels = undefined,
    placeFocusKnowledgePreferenceLabels = undefined,
    placeMinParticipants,
    placeMaxParticipants,
    initialPayload = null,
    embedded = false,
    bare = false,
    wizardSegment = 'both',
    onPlacesBlockLayout,
    headerBeforePlaces,
    scheduleListOnly = false,
    placesListOnly = false,
    parentScrollRef,
    parentScrollYRef,
    scheduleAiReplacesFirstCandidate = false,
    onNaverPlaceWebOpen,
    onPlacesAutoAssistSnapshot,
  },
  ref,
) {
  const insets = useSafeAreaInsets();
  const [voiceTarget, setVoiceTarget] = useState<'scheduleIdea' | 'placeQuery' | null>(null);
  const [voiceRecognizing, setVoiceRecognizing] = useState(false);
  /** 장소 검색어 자동 시드 갱신 시 덮어쓰지 않도록(직접 입력·음성·칩) */
  const placeQueryUserTouchedRef = useRef(false);
  /** 일정 음성 입력 종료 후 AI 프리뷰와 동일하게 달력·후보에 반영(칩 탭 생략) */
  const pendingVoiceScheduleApplyRef = useRef(false);
  const voiceScheduleAutoApplyTranscriptRef = useRef('');

  useSpeechRecognitionEvent('start', () => {
    if (!voiceTarget) return;
    setVoiceRecognizing(true);
  });
  useSpeechRecognitionEvent('end', () => {
    if (!voiceTarget) return;
    setVoiceRecognizing(false);
    setVoiceTarget(null);
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (!voiceTarget) return;
    setVoiceRecognizing(false);
    setVoiceTarget(null);
    Alert.alert('음성 입력 오류', humanizeSpeechRecognitionError(event));
  });
  useSpeechRecognitionEvent('result', (event) => {
    const t = String(event?.results?.[0]?.transcript ?? '').trim();
    if (!t) return;
    if (!voiceTarget) return;
    if (voiceTarget === 'scheduleIdea') setNlpScheduleInput(t);
    if (voiceTarget === 'placeQuery') {
      if (t.trim().length > 0) placeQueryUserTouchedRef.current = true;
      else placeQueryUserTouchedRef.current = false;
      setPlaceQuery(t);
    }
    if (event?.isFinal) {
      if (voiceTarget === 'scheduleIdea' && t) {
        pendingVoiceScheduleApplyRef.current = true;
        voiceScheduleAutoApplyTranscriptRef.current = t;
      }
      if (voiceTarget === 'placeQuery' && t) {
        // 음성 입력 종료 시: 검색 버튼/아웃포커스와 동일하게 자동 검색을 트리거합니다.
        placeQueryRef.current = t;
        triggerPlaceSearch();
      }
      setVoiceRecognizing(false);
      setVoiceTarget(null);
      ExpoSpeechRecognitionModule.stop();
    }
  });

  const onPressVoiceInput = useCallback(
    async (target: 'scheduleIdea' | 'placeQuery') => {
      if (voiceRecognizing && voiceTarget === target) {
        ExpoSpeechRecognitionModule.stop();
        return;
      }
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('권한 필요', '음성 입력을 사용하려면 마이크/음성 인식 권한이 필요합니다.');
        return;
      }
      setVoiceTarget(target);
      ExpoSpeechRecognitionModule.start({
        lang: 'ko-KR',
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
      });
    },
    [voiceRecognizing, voiceTarget],
  );
  const router = useRouter();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const seedQ = seedPlaceQuery.trim();
  const seedDate = seedScheduleDate.trim() || fmtDate(new Date());
  const seedTime = seedScheduleTime.trim() || '15:00';

  const init = buildInitialEditorState(initialPayload, seedQ, seedDate, seedTime);
  const [placeCandidates, setPlaceCandidates] = useState<PlaceRowModel[]>(() => init.placeCandidates);
  const [dateCandidates, setDateCandidates] = useState<DateCandidate[]>(() => init.dateCandidates);

  const [picker, setPicker] = useState<{ rowId: string; field: DatePickerField } | null>(null);
  const [iosDraft, setIosDraft] = useState(() => new Date());
  const [nlpScheduleInput, setNlpScheduleInput] = useState('');
  const [nlpParsed, setNlpParsed] = useState<SmartNlpResult | null>(null);
  const [weekendPreviewSlots, setWeekendPreviewSlots] = useState<{ ymd: string; hm: string }[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(() => monthStartYmd(fmtDate(new Date())));
  /** 일정 달력 가로 페이지(이전·현재·다음 달) — `onLayout`으로 정확한 너비 갱신 */
  const [scheduleCalendarPagerW, setScheduleCalendarPagerW] = useState(() => Math.max(280, Math.floor(windowWidth)));
  const scheduleCalendarPagerRef = useRef<ScrollView>(null);
  /** `scrollTo` 가운데 정렬 직후 가짜 `onMomentumScrollEnd`로 월이 두 칸 넘어가지 않게 함 */
  const scheduleCalendarPagerIgnoreMomentumEndRef = useRef(false);
  const scheduleCalendarCenterOpacity = useRef(new Animated.Value(1)).current;
  const scheduleCalendarSwipeFadeAfterRecenterRef = useRef(false);
  const scheduleCalendarFadeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  /** 일정 달력 헤더 년·월 탭 → 네이티브 날짜 피커(년·월 반영 후 해당 월 1일로 정규화) */
  const [scheduleCalendarYmPick, setScheduleCalendarYmPick] = useState<{ draft: Date } | null>(null);
  const [timePick, setTimePick] = useState<{ ymd: string; draft: Date; source?: 'calendar' | 'ai' } | null>(null);
  /** FAB 자동 일정 — 탭한 날처럼 보이도록 달력 셀만 잠시 강조 */
  const [agentScheduleDemoHighlightYmd, setAgentScheduleDemoHighlightYmd] = useState<string | null>(null);
  const [dateDetailExpanded, setDateDetailExpanded] = useState<Record<string, boolean>>({});
  const [deadlineTick, setDeadlineTick] = useState(0);
  const dateScrollRef = useRef<ScrollView>(null);
  /** `+ 일정 후보 추가` 직후: 새 카드 첫 입력 자동 포커스 */
  const pendingAutoFocusDateIdRef = useRef<string | null>(null);
  /** 일정 아이디어 입력(자연어) — 새로 마운트될 때 자동 포커스 */
  const nlpIdeaInputRef = useRef<TextInput>(null);
  /** 장소 후보 검색어 입력 — 새로 마운트될 때 자동 포커스 */
  const placeQueryInputRef = useRef<TextInput>(null);
  const nlpIdeaDeferKb = useMemo(() => deferSoftInputUntilUserTapProps(nlpIdeaInputRef), []);
  const placeQueryDeferKb = useMemo(() => deferSoftInputUntilUserTapProps(placeQueryInputRef), []);

  // 장소 후보 단계: 인라인 검색 UI (AI 초기 검색어 + 추천 검색어 + 결과 그리드)
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeBiasHint, setPlaceBiasHint] = useState<string | null>(null);
  const [placeSearchRows, setPlaceSearchRows] = useState<PlaceSearchRow[]>([]);
  const [placeSearchNextPageToken, setPlaceSearchNextPageToken] = useState<string | null>(null);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [placeSearchLoadingMore, setPlaceSearchLoadingMore] = useState(false);
  const [placeSearchErr, setPlaceSearchErr] = useState<string | null>(null);
  const [placeThumbById, setPlaceThumbById] = useState<Record<string, string | null>>({});
  const [placeSelectedById, setPlaceSelectedById] = useState<Record<string, { placeName: string; address: string }>>(
    {},
  );
  const [placeResolvingById, setPlaceResolvingById] = useState<Record<string, boolean>>({});
  /** 인라인 검색 한 사이클이 끝난 뒤의 쿼리(로딩 false 직후) — 자동 모드가 결과를 기다릴 때 사용 */
  const [placeSearchLastSettledQueryTrim, setPlaceSearchLastSettledQueryTrim] = useState<string | null>(null);
  const [naverPlaceWebModal, setNaverPlaceWebModal] = useState<{ url: string; title: string } | null>(null);

  const placeQueryRef = useRef(placeQuery);
  placeQueryRef.current = placeQuery;
  const [placeSearchTriggerSeq, setPlaceSearchTriggerSeq] = useState(0);
  const placeSearchActiveQueryTrimRef = useRef<string>('');
  const placeSearchRowsRef = useRef(placeSearchRows);
  placeSearchRowsRef.current = placeSearchRows;
  const placeSearchErrRef = useRef(placeSearchErr);
  placeSearchErrRef.current = placeSearchErr;
  const placeSearchLoadingRef = useRef(placeSearchLoading);
  placeSearchLoadingRef.current = placeSearchLoading;
  const placeSearchLoadingMoreRef = useRef(placeSearchLoadingMore);
  placeSearchLoadingMoreRef.current = placeSearchLoadingMore;
  const placeSearchNextPageTokenRef = useRef<string | null>(null);
  placeSearchNextPageTokenRef.current = placeSearchNextPageToken;
  const placeSearchLoadMoreGuardRef = useRef(false);
  const placeSearchLastSettledQueryTrimRef = useRef(placeSearchLastSettledQueryTrim);
  placeSearchLastSettledQueryTrimRef.current = placeSearchLastSettledQueryTrim;
  const placeResultsCarouselViewportWRef = useRef(0);
  const placeResultsCarouselContentWRef = useRef(0);

  const placeCandidatesRef = useRef(placeCandidates);
  placeCandidatesRef.current = placeCandidates;
  const dateCandidatesRef = useRef(dateCandidates);
  dateCandidatesRef.current = dateCandidates;
  /** 레거시: place-search 화면 이동 플로우에서 쓰던 임시 행 ID (현재는 인라인 검색 UI 사용) */
  const pendingEphemeralPlaceRowIdRef = useRef<string | null>(null);

  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const [stackTransitionCoversScreen, setStackTransitionCoversScreen] = useState(false);
  useEffect(() => {
    type TransitionNav = {
      addListener: (event: string, cb: (e: { data?: { closing?: boolean } }) => void) => () => void;
    };
    const nav = navigation as unknown as TransitionNav;
    const onStart = nav.addListener('transitionStart', (e) => {
      if (e.data?.closing) setStackTransitionCoversScreen(true);
    });
    const onEnd = nav.addListener('transitionEnd', () => {
      setStackTransitionCoversScreen(false);
    });
    return () => {
      onStart();
      onEnd();
    };
  }, [navigation]);

  const reduceHeavyEffects = !isFocused || stackTransitionCoversScreen;
  const { userId: sessionUserId } = useUserSession();

  const guardDateCandidatesOverlapOrAlert = useCallback(async (nextDates: DateCandidate[]): Promise<boolean> => {
    try {
      await assertDateCandidatesNoOverlapWithOtherMeetings({
        appUserId: sessionUserId,
        candidates: nextDates,
        bufferHours: DATE_CANDIDATE_OVERLAP_BUFFER_HOURS,
        excludeMeetingId: null,
      });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showTransientBottomMessage(`${GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION}\n\n${msg}`);
      return false;
    }
  }, [sessionUserId]);

  const hasDeadlineRow = useMemo(() => dateCandidates.some((d) => d.type === 'deadline'), [dateCandidates]);
  useEffect(() => {
    if (!hasDeadlineRow) return undefined;
    const i = setInterval(() => setDeadlineTick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [hasDeadlineRow]);

  /** 가로 페이징 달력: 항상 가운데(현재 달) 페이지로 스크롤 위치 동기화 */
  useLayoutEffect(() => {
    if (scheduleCalendarPagerW <= 0) return undefined;
    // rAF 안에서만 켜면 scrollTo 직전에 가짜 onMomentumScrollEnd가 들어와 월이 두 칸 움직일 수 있음 → 동기 처리
    scheduleCalendarPagerIgnoreMomentumEndRef.current = true;
    scheduleCalendarPagerRef.current?.scrollTo({
      x: scheduleCalendarPagerW,
      animated: false,
    });
    if (scheduleCalendarSwipeFadeAfterRecenterRef.current) {
      scheduleCalendarSwipeFadeAfterRecenterRef.current = false;
      scheduleCalendarFadeAnimRef.current?.stop?.();
      const anim = Animated.timing(scheduleCalendarCenterOpacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      scheduleCalendarFadeAnimRef.current = anim;
      anim.start(({ finished }) => {
        if (finished) scheduleCalendarFadeAnimRef.current = null;
      });
    }
    let clearRaf1: number | null = null;
    let clearRaf2: number | null = null;
    let clearRaf3: number | null = null;
    clearRaf1 = requestAnimationFrame(() => {
      clearRaf2 = requestAnimationFrame(() => {
        clearRaf3 = requestAnimationFrame(() => {
          scheduleCalendarPagerIgnoreMomentumEndRef.current = false;
        });
      });
    });
    return () => {
      if (clearRaf1 != null) cancelAnimationFrame(clearRaf1);
      if (clearRaf2 != null) cancelAnimationFrame(clearRaf2);
      if (clearRaf3 != null) cancelAnimationFrame(clearRaf3);
      scheduleCalendarPagerIgnoreMomentumEndRef.current = false;
      scheduleCalendarFadeAnimRef.current?.stop?.();
    };
  }, [calendarMonth, scheduleCalendarPagerW]);

  useEffect(() => {
    const trimmed = nlpScheduleInput.trim();
    if (!trimmed) {
      setNlpParsed(null);
      setWeekendPreviewSlots([]);
      if (pendingVoiceScheduleApplyRef.current) {
        pendingVoiceScheduleApplyRef.current = false;
        voiceScheduleAutoApplyTranscriptRef.current = '';
      }
      return undefined;
    }
    if (weekendAnytimeMatches(trimmed)) {
      setNlpParsed(null);
      const pool = upcomingWeekendSlotPool(new Date());
      setWeekendPreviewSlots(pickRandomUniqueSlots(pool, WEEKEND_ANYTIME_PREVIEW_COUNT));
      if (pendingVoiceScheduleApplyRef.current) {
        pendingVoiceScheduleApplyRef.current = false;
        voiceScheduleAutoApplyTranscriptRef.current = '';
      }
      return undefined;
    }
    setWeekendPreviewSlots([]);
    const t = setTimeout(() => {
      const p = parseSmartNaturalSchedule(trimmed, new Date());
      setNlpParsed(p);
      if (pendingVoiceScheduleApplyRef.current && !p) {
        pendingVoiceScheduleApplyRef.current = false;
        voiceScheduleAutoApplyTranscriptRef.current = '';
      }
    }, 500);
    return () => clearTimeout(t);
  }, [nlpScheduleInput]);

  const applyNlpSuggestion = useCallback(async () => {
    const trimmed = nlpScheduleInput.trim();
    if (weekendAnytimeMatches(trimmed)) {
      return;
    }
    const parsed = nlpParsed ?? (trimmed ? parseSmartNaturalSchedule(trimmed, new Date()) : null);
    if (!parsed) return;
    const parsedPoint: SmartNlpResult = {
      summary: parsed.summary,
      candidate: {
        type: 'point',
        startDate: String(parsed.candidate.startDate ?? '').trim() || fmtDateYmd(new Date()),
        startTime: String(parsed.candidate.startTime ?? '').trim() || defaultScheduleTimePlus3Hours(),
      },
    };
    animate();
    const prev = dateCandidatesRef.current;
    const nextKey = dateCandidateDupKey({ id: 'nlp', ...(parsedPoint.candidate as Omit<DateCandidate, 'id'>) });

    if (scheduleAiReplacesFirstCandidate) {
      const first = prev[0];
      if (!first) return;
      const patched = forcePointCandidate({
        ...first,
        startDate: parsedPoint.candidate.startDate,
        startTime: parsedPoint.candidate.startTime,
      } as DateCandidate);
      const pk = dateCandidateDupKey(patched);
      if (prev.slice(1).some((d) => dateCandidateDupKey(d) === pk)) {
        Alert.alert('동일한 일정 후보가 있습니다.');
        return;
      }
      if (dateCandidateDupKey(first) === pk) {
        setNlpScheduleInput('');
        setNlpParsed(null);
        return;
      }
      const next = [patched, ...prev.slice(1)];
      for (let i = 0; i < next.length; i += 1) {
        const err = validateDateCandidate(next[i], i);
        if (err) {
          Alert.alert(
            '일시 확인',
            `${err}\n\n자연어로 추가할 때도 오늘 이후이며, 지금부터 최소 1시간 이상 남은 일정만 등록할 수 있어요.`,
          );
          return;
        }
      }
      const forcedNext = next.map(forcePointCandidate);
      if (!(await guardDateCandidatesOverlapOrAlert(forcedNext))) return;
      setDateCandidates(forcedNext);
      setNlpScheduleInput('');
      setNlpParsed(null);
      return;
    }

    const dup = prev.some((d) => dateCandidateDupKey(d) === nextKey);
    if (dup) {
      Alert.alert('동일한 일정 후보가 있습니다.');
      return;
    }
    const { next, expandRowId, shouldAutoExpand, didAppend } = computeNlpApply(prev, parsedPoint);
    for (let i = 0; i < next.length; i += 1) {
      const err = validateDateCandidate(next[i], i);
      if (err) {
        Alert.alert(
          '일시 확인',
          `${err}\n\n자연어로 추가할 때도 오늘 이후이며, 지금부터 최소 1시간 이상 남은 일정만 등록할 수 있어요.`,
        );
        return;
      }
    }
    const forcedAppend = next.map(forcePointCandidate);
    if (!(await guardDateCandidatesOverlapOrAlert(forcedAppend))) return;
    setDateCandidates(forcedAppend);
    if (shouldAutoExpand && expandRowId) {
      setDateDetailExpanded((ex) => ({ ...ex, [expandRowId]: true }));
    }
    setNlpScheduleInput('');
    setNlpParsed(null);
    if (didAppend && !bare) {
      requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          dateScrollRef.current?.scrollToEnd({ animated: true });
        });
      });
    } else if (didAppend && bare && parentScrollRef?.current && parentScrollYRef) {
      requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          setTimeout(() => {
            const sc = parentScrollRef?.current;
            if (!sc || !parentScrollYRef) return;
            const cur = parentScrollYRef.current ?? 0;
            const nextY = cur + 380;
            requestAnimationFrame(() => {
              if (typeof sc.scrollTo === 'function') {
                sc.scrollTo({ y: nextY, animated: true });
                return;
              }
              if (typeof sc.scrollToPosition === 'function') {
                sc.scrollToPosition(0, nextY, true);
              }
            });
          }, 96);
        });
      });
    }
  }, [
    bare,
    guardDateCandidatesOverlapOrAlert,
    nlpParsed,
    nlpScheduleInput,
    parentScrollRef,
    parentScrollYRef,
    scheduleAiReplacesFirstCandidate,
  ]);

  const commitPointCandidate = useCallback(
    async (ymd: string, hm: string) => {
      animate();
      const prev = dateCandidatesRef.current;

      if (scheduleAiReplacesFirstCandidate) {
        const first = prev[0];
        if (!first) return;
        const patched = forcePointCandidate({
          ...first,
          startDate: ymd,
          startTime: hm,
        } as DateCandidate);
        const key = dateCandidateDupKey(patched);
        if (prev.slice(1).some((d) => dateCandidateDupKey(d) === key)) {
          Alert.alert('동일한 일정 후보가 있습니다.');
          return;
        }
        if (dateCandidateDupKey(first) === key) {
          setNlpScheduleInput('');
          setNlpParsed(null);
          setWeekendPreviewSlots([]);
          return;
        }
        const next = [patched, ...prev.slice(1)];
        for (let i = 0; i < next.length; i += 1) {
          const err = validateDateCandidate(next[i], i);
          if (err) {
            Alert.alert('일시 확인', err);
            return;
          }
        }
        if (!(await guardDateCandidatesOverlapOrAlert(next))) return;
        setDateCandidates(next);
        setNlpScheduleInput('');
        setNlpParsed(null);
        setWeekendPreviewSlots([]);
        return;
      }

      const candidate = forcePointCandidate({
        id: newId('date'),
        type: 'point',
        startDate: ymd,
        startTime: hm,
      } as DateCandidate);
      const key = dateCandidateDupKey(candidate);
      if (prev.some((d) => dateCandidateDupKey(d) === key)) {
        Alert.alert('동일한 일정 후보가 있습니다.');
        return;
      }
      const next = [...prev, candidate];
      for (let i = 0; i < next.length; i += 1) {
        const err = validateDateCandidate(next[i], i);
        if (err) {
          Alert.alert('일시 확인', err);
          return;
        }
      }
      if (!(await guardDateCandidatesOverlapOrAlert(next))) return;
      setDateCandidates(next);
      setNlpScheduleInput('');
      setNlpParsed(null);
      setWeekendPreviewSlots([]);
      if (!bare) {
        requestAnimationFrame(() => {
          InteractionManager.runAfterInteractions(() => {
            dateScrollRef.current?.scrollToEnd({ animated: true });
          });
        });
      } else if (parentScrollRef?.current && parentScrollYRef) {
        requestAnimationFrame(() => {
          InteractionManager.runAfterInteractions(() => {
            setTimeout(() => {
              const sc = parentScrollRef?.current;
              if (!sc || !parentScrollYRef) return;
              const cur = parentScrollYRef.current ?? 0;
              const nextY = cur + 380;
              requestAnimationFrame(() => {
                if (typeof sc.scrollTo === 'function') {
                  sc.scrollTo({ y: nextY, animated: true });
                  return;
                }
                if (typeof sc.scrollToPosition === 'function') {
                  sc.scrollToPosition(0, nextY, true);
                }
              });
            }, 96);
          });
        });
      }
    },
    [bare, guardDateCandidatesOverlapOrAlert, parentScrollRef, parentScrollYRef, scheduleAiReplacesFirstCandidate],
  );

  const openTimePickerForDate = useCallback(
    (ymd: string, defaultHm?: string, source?: 'calendar' | 'ai') => {
      const base = clampHm((defaultHm ?? '').trim() || DEFAULT_CALENDAR_PICK_TIME);
      const d0 = dateFromYmd(ymd) ?? new Date();
      const m = /^(\d{2}):(\d{2})$/.exec(base);
      const hh = m ? Number(m[1]) : 19;
      const mm = m ? Number(m[2]) : 0;
      const draft = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), hh, mm, 0, 0);
      setTimePick({ ymd, draft, source });
    },
    [],
  );

  const confirmTimePick = useCallback(() => {
    const cur = timePick;
    if (!cur) return;
    const hm = fmtTime(cur.draft);
    setTimePick(null);
    void commitPointCandidate(cur.ymd, hm);
  }, [commitPointCandidate, timePick]);

  const confirmScheduleCalendarYmPick = useCallback(() => {
    const cur = scheduleCalendarYmPick;
    if (!cur) return;
    setCalendarMonth(monthStartYmd(fmtDate(cur.draft)));
    setScheduleCalendarYmPick(null);
  }, [scheduleCalendarYmPick]);

  const appendWeekendPreviewSlot = useCallback(
    async (slot: { ymd: string; hm: string }) => {
      void commitPointCandidate(slot.ymd, slot.hm);
    },
    [commitPointCandidate],
  );

  const onPressAiPreviewParsed = useCallback(() => {
    const c = nlpParsed?.candidate;
    const sd = String(c?.startDate ?? '').trim();
    const st = String(c?.startTime ?? '').trim();
    const ymd = sd || fmtDate(new Date());
    const hm = st || DEFAULT_CALENDAR_PICK_TIME;
    void commitPointCandidate(ymd, hm);
  }, [commitPointCandidate, nlpParsed]);

  useEffect(() => {
    if (!pendingVoiceScheduleApplyRef.current) return;
    const expected = (voiceScheduleAutoApplyTranscriptRef.current ?? '').trim();
    const cur = nlpScheduleInput.trim();
    if (!cur || !expected) {
      pendingVoiceScheduleApplyRef.current = false;
      voiceScheduleAutoApplyTranscriptRef.current = '';
      return;
    }
    if (cur !== expected) {
      pendingVoiceScheduleApplyRef.current = false;
      voiceScheduleAutoApplyTranscriptRef.current = '';
      return;
    }
    if (weekendPreviewSlots.length > 0) {
      pendingVoiceScheduleApplyRef.current = false;
      voiceScheduleAutoApplyTranscriptRef.current = '';
      return;
    }
    if (!nlpParsed) return;
    const verify = parseSmartNaturalSchedule(cur, new Date());
    if (!verify || verify.summary !== nlpParsed.summary) return;
    pendingVoiceScheduleApplyRef.current = false;
    voiceScheduleAutoApplyTranscriptRef.current = '';
    void onPressAiPreviewParsed();
  }, [nlpScheduleInput, nlpParsed, weekendPreviewSlots.length, onPressAiPreviewParsed]);

  const playAgentSchedulePickAnimation = useCallback(
    async (opts: { ymd: string; hm: string; isAlive: () => boolean }) => {
      const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      const targetYmd = (opts.ymd ?? '').trim();
      const targetHm = clampHm((opts.hm ?? '').trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetYmd)) {
        setAgentScheduleDemoHighlightYmd(null);
        return;
      }

      setAgentScheduleDemoHighlightYmd(null);
      setTimePick(null);
      setCalendarMonth(monthStartYmd(targetYmd));
      await sleepMs(380);
      if (!opts.isAlive()) return;

      setAgentScheduleDemoHighlightYmd(targetYmd);
      await sleepMs(480);
      if (!opts.isAlive()) {
        setAgentScheduleDemoHighlightYmd(null);
        return;
      }

      const runWheelDemo = Platform.OS === 'ios' || Platform.OS === 'web';
      const dayBase = dateFromYmd(targetYmd) ?? new Date();

      const toMin = (hm: string) => {
        const x = clampHm(hm);
        const m = /^(\d{2}):(\d{2})$/.exec(x);
        if (!m) return 19 * 60;
        return Number(m[1]) * 60 + Number(m[2]);
      };
      const fromMin = (total: number) => {
        const u = ((Math.round(total) % (24 * 60)) + 24 * 60) % (24 * 60);
        return `${pad2(Math.floor(u / 60))}:${pad2(u % 60)}`;
      };

      if (runWheelDemo) {
        const startHm = toMin(targetHm) >= 18 * 60 ? '15:00' : '10:00';
        openTimePickerForDate(targetYmd, startHm, 'calendar');
        await sleepMs(300);
        if (!opts.isAlive()) {
          setTimePick(null);
          setAgentScheduleDemoHighlightYmd(null);
          return;
        }
        const steps = 8;
        for (let s = 0; s <= steps; s += 1) {
          if (!opts.isAlive()) {
            setTimePick(null);
            setAgentScheduleDemoHighlightYmd(null);
            return;
          }
          const a = s / steps;
          const midM = Math.round(toMin(startHm) + (toMin(targetHm) - toMin(startHm)) * a);
          const hmStr = fromMin(midM);
          const mHm = /^(\d{2}):(\d{2})$/.exec(hmStr);
          const hh = mHm ? Number(mHm[1]) : 19;
          const mm = mHm ? Number(mHm[2]) : 0;
          const draft = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), hh, mm, 0, 0);
          setTimePick((prev) =>
            prev ? { ...prev, draft } : { ymd: targetYmd, draft, source: 'calendar' },
          );
          await sleepMs(s === 0 ? 160 : 80);
        }
        await sleepMs(240);
        if (!opts.isAlive()) {
          setTimePick(null);
          setAgentScheduleDemoHighlightYmd(null);
          return;
        }
        setTimePick(null);
        await commitPointCandidate(targetYmd, targetHm);
      } else {
        await sleepMs(200);
        if (!opts.isAlive()) {
          setAgentScheduleDemoHighlightYmd(null);
          return;
        }
        await commitPointCandidate(targetYmd, targetHm);
      }
      setAgentScheduleDemoHighlightYmd(null);
    },
    [commitPointCandidate, openTimePickerForDate],
  );

  const commitPlaceSearchRowAsAgentCandidate = useCallback(async (item: PlaceSearchRow): Promise<boolean> => {
    const title = item.title;
    const addr = (item.roadAddress || item.address || '').trim();
    try {
      setPlaceResolvingById((prev) => ({ ...prev, [item.id]: true }));
      const resolved = await resolvePlaceSearchRowCoordinates(item);
      const address = resolved.roadAddress?.trim() || resolved.address?.trim() || addr;
      if (resolved.latitude == null || resolved.longitude == null) throw new Error('좌표 없음');
      const placeName = resolved.title.trim() || title.trim();
      const linkFromApi =
        sanitizeNaverLocalPlaceLink(resolved.link) ?? sanitizeNaverLocalPlaceLink(item.link);
      const thumb = (resolved.thumbnailUrl ?? '').trim();
      const cat = (resolved.category ?? item.category ?? '').trim();
      const p: PlaceCandidate = {
        id: newId('place'),
        placeName,
        address,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        ...(cat ? { category: cat } : {}),
        ...(linkFromApi ? { naverPlaceLink: linkFromApi } : {}),
        ...(thumb.startsWith('https://') ? { preferredPhotoMediaUrl: thumb } : {}),
      };
      setPlaceSelectedById((prev) => ({ ...prev, [item.id]: { placeName, address } }));
      setPlaceCandidates((prev) => {
        const hit = prev.some((r) => r.placeName === p.placeName && r.address === p.address);
        if (hit) return prev;
        return [...prev, placeRowFromCandidate(p)];
      });
      return true;
    } catch (e) {
      setPlaceSearchErr(e instanceof Error ? e.message : '장소 추가에 실패했습니다.');
      return false;
    } finally {
      setPlaceResolvingById((prev) => ({ ...prev, [item.id]: false }));
    }
  }, []);

  const playAgentPlaceInlinePick = useCallback(
    async (opts: { maxPicks: number; isAlive: () => boolean }): Promise<'ok' | 'empty' | 'error' | 'aborted'> => {
      const sleepPick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      const waitDeadline = Date.now() + 22000;
      while (Date.now() < waitDeadline) {
        if (!opts.isAlive()) return 'aborted';
        const q = placeQueryRef.current.trim();
        if (
          q.length > 0 &&
          !placeSearchLoadingRef.current &&
          placeSearchLastSettledQueryTrimRef.current === q
        ) {
          break;
        }
        await sleepPick(40);
      }
      if (!opts.isAlive()) return 'aborted';
      const qNow = placeQueryRef.current.trim();
      if (
        qNow.length === 0 ||
        placeSearchLoadingRef.current ||
        placeSearchLastSettledQueryTrimRef.current !== qNow
      ) {
        return 'error';
      }
      if (placeSearchErrRef.current) return 'error';
      const cap = Math.min(INLINE_PLACE_PICK_MAX_SELECTED, Math.max(1, Math.trunc(opts.maxPicks)));
      const rows = placeSearchRowsRef.current.slice(0, cap);
      if (rows.length === 0) return 'empty';
      for (const item of rows) {
        if (!opts.isAlive()) return 'aborted';
        const ok = await commitPlaceSearchRowAsAgentCandidate(item);
        if (!ok) return 'error';
      }
      return 'ok';
    },
    [commitPlaceSearchRowAsAgentCandidate],
  );

  useImperativeHandle(
    ref,
    () => ({
      validateScheduleStep: async (): Promise<VoteCandidatesGateResult> => {
        const dates = dateCandidatesRef.current;
        if (dates.length === 0) {
          return { ok: false, error: '일시 후보를 최소 1개 이상 등록해 주세요.' };
        }
        for (let i = 0; i < dates.length; i += 1) {
          const err = validateDateCandidate(dates[i], i);
          if (err) return { ok: false, error: err };
        }
        try {
          await assertDateCandidatesNoOverlapWithOtherMeetings({
            appUserId: sessionUserId,
            candidates: dates,
            bufferHours: DATE_CANDIDATE_OVERLAP_BUFFER_HOURS,
            excludeMeetingId: null,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: `${GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION}\n\n${msg}` };
        }
        return { ok: true };
      },
      validatePlacesStep: (): VoteCandidatesGateResult => {
        const rows = placeCandidatesRef.current;
        const filledPlaces = rows.filter(isFilled);
        if (filledPlaces.length === 0) {
          return { ok: false, error: '장소 후보를 한 곳 이상 검색 결과에서 골라 주세요.' };
        }
        if (filledPlaces.length > INLINE_PLACE_PICK_MAX_SELECTED) {
          return {
            ok: false,
            error: `장소 후보는 최대 ${INLINE_PLACE_PICK_MAX_SELECTED}곳까지 선택할 수 있어요.`,
          };
        }
        return { ok: true };
      },
      buildPayload: (): VoteCandidatesBuildResult => {
        const rows = placeCandidatesRef.current;
        const dates = dateCandidatesRef.current;
        const filledPlaces = rows.filter(isFilled);
        if (filledPlaces.length === 0) {
          return { ok: false, error: '장소 후보를 한 곳 이상 검색 결과에서 골라 주세요.' };
        }
        if (filledPlaces.length > INLINE_PLACE_PICK_MAX_SELECTED) {
          return {
            ok: false,
            error: `장소 후보는 최대 ${INLINE_PLACE_PICK_MAX_SELECTED}곳까지 선택할 수 있어요.`,
          };
        }
        for (let i = 0; i < dates.length; i += 1) {
          const err = validateDateCandidate(dates[i], i);
          if (err) return { ok: false, error: err };
        }
        const placeCandidatesOut = filledPlaces.map(
          (r) =>
            stripUndefinedDeep({
              id: r.id,
              placeName: r.placeName.trim(),
              address: r.address.trim(),
              latitude: Number(r.latitude),
              longitude: Number(r.longitude),
              ...(r.category?.trim() ? { category: r.category.trim() } : {}),
              ...(r.naverPlaceLink?.trim() ? { naverPlaceLink: r.naverPlaceLink.trim() } : {}),
              ...(r.preferredPhotoMediaUrl?.trim().startsWith('https://')
                ? { preferredPhotoMediaUrl: r.preferredPhotoMediaUrl.trim() }
                : {}),
            }) as PlaceCandidate,
        );
        const dateCandidatesOut = dates.map((d) => stripUndefinedDeep({ ...d }) as DateCandidate);
        return { ok: true, payload: { placeCandidates: placeCandidatesOut, dateCandidates: dateCandidatesOut } };
      },
      /** 키보드는 사용자가 입력창을 탭할 때만 뜨도록, 자동 포커스는 하지 않습니다. */
      focusScheduleIdeaInput: () => {},
      focusPlaceQueryInput: () => {},
      openFirstPlaceSearchWithSuggestedQuery: (suggestedQuery: string, opts?: { createAutopilot?: boolean }) => {
        const q = suggestedQuery.trim() || '카페';
        setPlaceCandidates((prev) => {
          if (prev.length === 0) return [emptyPlaceRow(q)];
          return prev.map((r, i) => (i === 0 ? { ...r, query: q } : r));
        });
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            InteractionManager.runAfterInteractions(() => {
              const r0 = placeCandidatesRef.current[0];
              if (!r0) return;
              router.push({
                pathname: '/place-search',
                params: {
                  initialQuery: q,
                  voteRowId: r0.id,
                  ...(opts?.createAutopilot ? { createAutopilot: '1' } : {}),
                },
              });
            });
          });
        });
      },
      setPlaceQueryFromAgent: (q: string) => {
        const qt = q.trim();
        if (!qt) return;
        placeQueryUserTouchedRef.current = true;
        setPlaceCandidates((prev) => {
          if (prev.length === 0) return [emptyPlaceRow(qt)];
          return prev.map((r, i) => (i === 0 ? { ...r, query: qt } : r));
        });
        placeQueryRef.current = qt;
        setPlaceQuery(qt);
        // AI 자동 생성 플로우: 검색 버튼/아웃포커스와 동일하게 즉시 검색을 트리거합니다.
        triggerPlaceSearch();
      },
      resetPlaceSearchSession: () => {
        pendingEphemeralPlaceRowIdRef.current = null;
        setPicker(null);
      },
      ensurePlacesForWizardFinalize: () => {
        const rows = placeCandidatesRef.current;
        if (rows.some(isFilled)) return;
        // 초기 상태는 "장소 후보 0개"를 허용하고, 사용자가 `+ 장소 후보 추가`로만 추가하도록 유지합니다.
      },
      captureWizardPayloadAfterSchedule: (): VoteCandidatesBuildResult => {
        const dates = dateCandidatesRef.current;
        for (let i = 0; i < dates.length; i += 1) {
          const err = validateDateCandidate(dates[i], i);
          if (err) return { ok: false, error: err };
        }
        const filled = placeCandidatesRef.current.filter(isFilled);
        // 일정 확정 단계에서는 "장소 후보 0개"를 허용합니다.
        // (다음 단계인 장소 후보 단계에서 사용자가 `+ 장소 후보 추가`로 선택하도록)
        const placeCandidatesOut = filled.map(
          (r) =>
            stripUndefinedDeep({
              id: r.id,
              placeName: r.placeName.trim(),
              address: r.address.trim(),
              latitude: Number(r.latitude),
              longitude: Number(r.longitude),
              ...(r.category?.trim() ? { category: r.category.trim() } : {}),
              ...(r.naverPlaceLink?.trim() ? { naverPlaceLink: r.naverPlaceLink.trim() } : {}),
              ...(r.preferredPhotoMediaUrl?.trim().startsWith('https://')
                ? { preferredPhotoMediaUrl: r.preferredPhotoMediaUrl.trim() }
                : {}),
            }) as PlaceCandidate,
        );
        const dateCandidatesOut = dates.map((d) => stripUndefinedDeep({ ...d }) as DateCandidate);
        return { ok: true, payload: { placeCandidates: placeCandidatesOut, dateCandidates: dateCandidatesOut } };
      },
      capturePlaceCandidatesOnly: (): VoteCandidatesBuildResult => {
        const rows = placeCandidatesRef.current;
        const filledPlaces = rows.filter(isFilled);
        if (filledPlaces.length === 0) {
          return { ok: false, error: '장소 후보를 한 곳 이상 검색 결과에서 골라 주세요.' };
        }
        if (filledPlaces.length > INLINE_PLACE_PICK_MAX_SELECTED) {
          return {
            ok: false,
            error: `장소 후보는 최대 ${INLINE_PLACE_PICK_MAX_SELECTED}곳까지 선택할 수 있어요.`,
          };
        }
        const placeCandidatesOut = filledPlaces.map(
          (r) =>
            stripUndefinedDeep({
              id: r.id,
              placeName: r.placeName.trim(),
              address: r.address.trim(),
              latitude: Number(r.latitude),
              longitude: Number(r.longitude),
              ...(r.category?.trim() ? { category: r.category.trim() } : {}),
              ...(r.naverPlaceLink?.trim() ? { naverPlaceLink: r.naverPlaceLink.trim() } : {}),
              ...(r.preferredPhotoMediaUrl?.trim().startsWith('https://')
                ? { preferredPhotoMediaUrl: r.preferredPhotoMediaUrl.trim() }
                : {}),
            }) as PlaceCandidate,
        );
        return { ok: true, payload: { placeCandidates: placeCandidatesOut, dateCandidates: [] } };
      },
      applyCapturedPayload: (p: VoteCandidatesPayload) => {
        const next = buildInitialEditorState(p, seedQ, seedDate, seedTime);
        setPlaceCandidates(next.placeCandidates);
        setDateCandidates(next.dateCandidates);
      },
      playAgentPlaceInlinePick,
      playAgentSchedulePickAnimation,
    }),
    [router, seedQ, seedDate, seedTime, sessionUserId, playAgentPlaceInlinePick, playAgentSchedulePickAnimation],
  );

  useFocusEffect(
    useCallback(() => {
      const sel = consumePendingVotePlaceRow();
      if (sel) {
        pendingEphemeralPlaceRowIdRef.current = null;
        setPlaceCandidates((prev) => {
          const hit = prev.some((r) => r.id === sel.rowId);
          if (!hit) return prev;
          return prev.map((r) =>
            r.id === sel.rowId
              ? {
                  ...r,
                  query: sel.placeName,
                  placeName: sel.placeName,
                  address: sel.address,
                  latitude: sel.latitude,
                  longitude: sel.longitude,
                  ...(sel.category?.trim() ? { category: sel.category.trim() } : {}),
                  ...(sel.naverPlaceLink?.trim() ? { naverPlaceLink: sel.naverPlaceLink.trim() } : {}),
                  ...(sel.preferredPhotoMediaUrl?.trim().startsWith('https://')
                    ? { preferredPhotoMediaUrl: sel.preferredPhotoMediaUrl.trim() }
                    : {}),
                }
              : r,
          );
        });
        InteractionManager.runAfterInteractions(() => animate());
        return;
      }

      const ephemeralId = pendingEphemeralPlaceRowIdRef.current;
      pendingEphemeralPlaceRowIdRef.current = null;
      if (!ephemeralId) return;

      setPlaceCandidates((prev) => {
        const row = prev.find((r) => r.id === ephemeralId);
        if (!row || isFilled(row)) return prev;
        return prev.filter((r) => r.id !== ephemeralId);
      });
      InteractionManager.runAfterInteractions(() => animate());
    }, []),
  );

  const removePlaceCandidate = useCallback((id: string) => {
    animate();
    setPlaceCandidates((prev) => prev.filter((r) => r.id !== id));
  }, []);

  /** 펼친 일시 후보 카드 1장 + 여백에 가까운 세로 픽셀(부모 스크롤 보정용) */
  const SCHEDULE_CARD_SCROLL_APPROX = 380;

  const scrollParentAfterScheduleRowAdded = useCallback(() => {
    const sc = parentScrollRef?.current;
    if (!sc || !parentScrollYRef) return;
    const cur = parentScrollYRef.current ?? 0;
    const nextY = cur + SCHEDULE_CARD_SCROLL_APPROX;
    requestAnimationFrame(() => {
      if (typeof sc.scrollTo === 'function') {
        sc.scrollTo({ y: nextY, animated: true });
        return;
      }
      if (typeof sc.scrollToPosition === 'function') {
        sc.scrollToPosition(0, nextY, true);
      }
    });
  }, [parentScrollRef, parentScrollYRef]);

  const addDateRow = useCallback(() => {
    animate();
    const nid = newId('date');
    pendingAutoFocusDateIdRef.current = nid;
    setDateCandidates((prev) => {
      const last = prev[prev.length - 1];
      const row: DateCandidate = last
        ? { ...last, id: nid }
        : createPointCandidate(nid, fmtDate(new Date()), defaultScheduleTimePlus3Hours());
      return [...prev, row];
    });
    setDateDetailExpanded((ex) => ({ ...ex, [nid]: true }));
    if (!bare) {
      requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          dateScrollRef.current?.scrollToEnd({ animated: true });
        });
      });
    } else if (parentScrollRef?.current && parentScrollYRef) {
      requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          setTimeout(() => scrollParentAfterScheduleRowAdded(), 96);
        });
      });
    }
  }, [bare, parentScrollRef, parentScrollYRef, scrollParentAfterScheduleRowAdded]);

  const removeDateRow = useCallback((id: string) => {
    animate();
    setDateCandidates((prev) => (prev.length <= 1 ? prev : prev.filter((d) => d.id !== id)));
  }, []);

  const updateDateRow = useCallback((id: string, patch: Partial<DateCandidate>) => {
    setDateCandidates((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  const focusNextDateCandidateAfterWebSubmit = useCallback(
    (currentId: string) => {
      if (scheduleListOnly) return;
      const rows = dateCandidatesRef.current;
      const idx = rows.findIndex((d) => d.id === currentId);
      if (idx < 0) return;
      const next = rows[idx + 1];
      if (!next) return;
      pendingAutoFocusDateIdRef.current = next.id;
      animate();
      setDateDetailExpanded((ex) => ({ ...ex, [next.id]: true }));
      if (!bare) {
        requestAnimationFrame(() => {
          InteractionManager.runAfterInteractions(() => {
            dateScrollRef.current?.scrollToEnd({ animated: true });
          });
        });
      } else if (parentScrollRef?.current && parentScrollYRef) {
        requestAnimationFrame(() => {
          InteractionManager.runAfterInteractions(() => {
            setTimeout(() => scrollParentAfterScheduleRowAdded(), 96);
          });
        });
      }
    },
    [bare, parentScrollRef, parentScrollYRef, scheduleListOnly, scrollParentAfterScheduleRowAdded],
  );

  useEffect(() => {
    // 새 일정 행 추가 직후 `pendingAutoFocusDateIdRef` 정리(포커스는 사용자 탭 시에만).
    if (!pendingAutoFocusDateIdRef.current) return;
    const id = pendingAutoFocusDateIdRef.current;
    const hit = dateCandidates.some((d) => d.id === id);
    if (!hit) return;
    const t = setTimeout(() => {
      if (pendingAutoFocusDateIdRef.current === id) pendingAutoFocusDateIdRef.current = null;
    }, 400);
    return () => clearTimeout(t);
  }, [dateCandidates]);

  const openPicker = useCallback(
    (rowId: string, field: DatePickerField) => {
      const row = dateCandidates.find((d) => d.id === rowId);
      if (!row) return;
      setIosDraft(getPickerDraft(row, field));
      setPicker({ rowId, field });
    },
    [dateCandidates],
  );

  const iosPickerMinimumDate = useMemo(() => {
    if (!picker) return undefined;
    const row = dateCandidates.find((d) => d.id === picker.rowId);
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    if (!row) return today0;
    if (picker.field === 'startDate') return today0;
    return undefined;
  }, [picker, dateCandidates]);

  const iosPickerMaximumDate = useMemo(() => {
    if (!picker || picker.field !== 'startDate') return undefined;
    const maxD = maxSelectableScheduleDayStartLocal();
    return new Date(maxD.getFullYear(), maxD.getMonth(), maxD.getDate(), 23, 59, 59, 999);
  }, [picker]);

  const applyIosPicker = useCallback(async () => {
    if (!picker) return;
    const { rowId, field } = picker;
    const dates = dateCandidatesRef.current;
    const row = dates.find((d) => d.id === rowId);
    if (!row) {
      setPicker(null);
      return;
    }
    const idx = dates.findIndex((d) => d.id === rowId);
    const ymd = fmtDate(iosDraft);
    const hm = fmtTime(iosDraft);
    const next: DateCandidate =
      field === 'startDate'
        ? { ...row, startDate: ymd }
        : field === 'startTime'
          ? { ...row, startTime: hm }
          : row;
    const err = validateDateCandidate(next, Math.max(0, idx));
    if (err) {
      Alert.alert('일시 확인', err);
      return;
    }
    const nextDates = dates.map((d) => (d.id === rowId ? next : d));
    if (!(await guardDateCandidatesOverlapOrAlert(nextDates))) return;
    if (field === 'startDate') updateDateRow(rowId, { startDate: ymd });
    else if (field === 'startTime') updateDateRow(rowId, { startTime: hm });
    setPicker(null);
  }, [guardDateCandidatesOverlapOrAlert, iosDraft, picker, updateDateRow]);

  const showSchedule = wizardSegment === 'both' || wizardSegment === 'schedule';
  const showPlaces = wizardSegment === 'both' || wizardSegment === 'places';
  const prevShowPlacesRef = useRef(showPlaces);
  const prevFocusedRef = useRef(isFocused);
  const prevPlaceCandidatesLenRef = useRef(placeCandidates.length);
  const autoSearchOnceOnFirstNonEmptyQueryRef = useRef(true);

  const placeSuggestedQueries = useMemo(() => {
    return buildPlaceSuggestedSearchQueries({
      bias: placeBiasHint,
      categoryLabel: (placeThemeLabel || '').trim() || '모임',
      minParticipants: placeMinParticipants,
      maxParticipants: placeMaxParticipants,
      specialtyKind: placeThemeSpecialtyKind,
      menuPreferenceLabels: placeMenuPreferenceLabels,
      majorCode: placeThemeMajorCode,
      activityKindLabels: placeActivityKindLabels,
      placeGameKindLabels,
      focusKnowledgePreferenceLabels: placeFocusKnowledgePreferenceLabels,
    });
  }, [
    placeBiasHint,
    placeMinParticipants,
    placeMaxParticipants,
    placeThemeLabel,
    placeThemeSpecialtyKind,
    placeMenuPreferenceLabels,
    placeThemeMajorCode,
    placeActivityKindLabels,
    placeGameKindLabels,
    placeFocusKnowledgePreferenceLabels,
  ]);

  useEffect(() => {
    let alive = true;
    if (!showPlaces || placesListOnly) return undefined;
    void ensureNearbySearchBias().then(({ bias }) => {
      if (!alive) return;
      const b = bias?.trim() ?? null;
      setPlaceBiasHint(b);
      const defaultQ = buildDefaultPlaceSearchQuery({
        bias: b,
        categoryLabel: (placeThemeLabel || '').trim() || '모임',
        minParticipants: placeMinParticipants,
        maxParticipants: placeMaxParticipants,
        specialtyKind: placeThemeSpecialtyKind,
        menuPreferenceLabels: placeMenuPreferenceLabels,
        majorCode: placeThemeMajorCode,
        activityKindLabels: placeActivityKindLabels,
        placeGameKindLabels,
        focusKnowledgePreferenceLabels: placeFocusKnowledgePreferenceLabels,
      });
      setPlaceQuery((prev) => {
        if (placeQueryUserTouchedRef.current) return prev;
        return defaultQ;
      });
    });
    return () => {
      alive = false;
    };
  }, [
    placeMinParticipants,
    placeMaxParticipants,
    placeThemeLabel,
    placeThemeSpecialtyKind,
    placeMenuPreferenceLabels,
    placeThemeMajorCode,
    placeActivityKindLabels,
    placeGameKindLabels,
    placeFocusKnowledgePreferenceLabels,
    placesListOnly,
    showPlaces,
  ]);

  const loadMorePlaceSearchRows = useCallback(() => {
    if (!showPlaces || placesListOnly) return;
    if (placeSearchLoadingRef.current || placeSearchLoadingMoreRef.current) return;
    const token = placeSearchNextPageTokenRef.current?.trim() ?? '';
    if (!token) return;
    if (placeSearchLoadMoreGuardRef.current) return;
    const q = placeSearchActiveQueryTrimRef.current.trim();
    if (!q) return;
    placeSearchLoadMoreGuardRef.current = true;
    setPlaceSearchLoadingMore(true);
    void (async () => {
      try {
        const { bias, coords } = await ensureNearbySearchBias();
        const excludeStablePlaceKeys = placeSearchRowsRef.current.map((r) => stableNaverLocalSearchDedupeKey(r));
        const { places: list, nextPageToken: nxt } = await searchPlacesText(q, {
          locationBias: bias,
          userCoords: coords,
          maxResultCount: PLACE_SEARCH_PAGE_SIZE,
          pageToken: token,
          excludeStablePlaceKeys,
        });
        const prevRows = placeSearchRowsRef.current;
        const seen0 = new Set(prevRows.map((r) => r.id));
        const fresh0 = list.filter((r) => !seen0.has(r.id));
        if (fresh0.length === 0) {
          setPlaceSearchNextPageToken(null);
        } else {
          setPlaceSearchRows((prev) => {
            const seen = new Set(prev.map((r) => r.id));
            const fresh = list.filter((r) => !seen.has(r.id));
            return fresh.length ? [...prev, ...fresh] : prev;
          });
          setPlaceSearchNextPageToken(nxt?.trim() ? nxt.trim() : null);
        }
      } catch {
        /* 다음 페이지 실패 시 토큰 유지 — 스크롤 끝에서 재시도 가능 */
      } finally {
        setPlaceSearchLoadingMore(false);
        placeSearchLoadMoreGuardRef.current = false;
      }
    })();
  }, [placesListOnly, showPlaces]);

  const triggerPlaceSearch = useCallback(() => {
    if (!showPlaces || placesListOnly) return;
    setPlaceSearchTriggerSeq((n) => n + 1);
  }, [placesListOnly, showPlaces]);

  useEffect(() => {
    // 장소 후보 카드(섹션)가 활성화되는 순간: 현재 검색어로 1회 자동 검색
    // (타이핑 중 자동 검색은 금지 정책 유지)
    const prev = prevShowPlacesRef.current;
    prevShowPlacesRef.current = showPlaces;
    if (prev || !showPlaces || placesListOnly) return;
    const q = placeQueryRef.current.trim();
    if (!q) return;
    if (placeSearchLastSettledQueryTrimRef.current?.trim() === q) return;
    triggerPlaceSearch();
  }, [placesListOnly, showPlaces, triggerPlaceSearch]);

  useEffect(() => {
    // 장소 제안 팝업(Modal)처럼 showPlaces가 처음부터 true인 케이스:
    // 기본 검색어가 세팅된 뒤(비어있지 않게 된 순간) 1회 자동 검색을 수행합니다.
    // - wizardSegment='places' (장소 제안)에서는 항상 허용
    // - 그 외(모임 생성)에서는 장소 후보 카드가 1개라도 생긴 상태에서만 자동 검색
    if (!autoSearchOnceOnFirstNonEmptyQueryRef.current) return;
    if (!showPlaces || placesListOnly) return;
    const q = placeQuery.trim();
    if (!q) return;
    if (wizardSegment !== 'places' && placeCandidates.length === 0) return;
    if (placeSearchLastSettledQueryTrimRef.current?.trim() === q) {
      autoSearchOnceOnFirstNonEmptyQueryRef.current = false;
      return;
    }
    autoSearchOnceOnFirstNonEmptyQueryRef.current = false;
    triggerPlaceSearch();
  }, [placeCandidates.length, placeQuery, placesListOnly, showPlaces, triggerPlaceSearch, wizardSegment]);

  useEffect(() => {
    // 모임 상세 "장소 제안" 등: 화면 진입(포커스) 시 현재 검색어로 1회 자동 검색
    // showPlaces가 처음부터 true인 화면에서는 위 활성화 트리거가 동작하지 않을 수 있어 보강합니다.
    const prevFocused = prevFocusedRef.current;
    prevFocusedRef.current = isFocused;
    if (prevFocused || !isFocused) return;
    if (!showPlaces || placesListOnly) return;
    const q = placeQueryRef.current.trim();
    if (!q) return;
    if (placeSearchLastSettledQueryTrimRef.current?.trim() === q) return;
    triggerPlaceSearch();
  }, [isFocused, placesListOnly, showPlaces, triggerPlaceSearch]);

  useEffect(() => {
    // 모임 생성: `+ 장소 후보 추가` 등으로 첫 장소 후보 카드가 생성되는 순간,
    // 이미 입력된 검색어가 있다면 1회 자동 검색합니다.
    const prevLen = prevPlaceCandidatesLenRef.current;
    const nextLen = placeCandidates.length;
    prevPlaceCandidatesLenRef.current = nextLen;
    if (prevLen !== 0 || nextLen === 0) return;
    if (!showPlaces || placesListOnly) return;
    const q = placeQueryRef.current.trim();
    if (!q) return;
    if (placeSearchLastSettledQueryTrimRef.current?.trim() === q) return;
    triggerPlaceSearch();
  }, [placeCandidates.length, placesListOnly, showPlaces, triggerPlaceSearch]);

  const maybePrefetchPlaceSearchCarousel = useCallback(() => {
    if (!showPlaces || placesListOnly) return;
    if (placeSearchLoadingRef.current || placeSearchLoadingMoreRef.current) return;
    if (!placeSearchNextPageTokenRef.current?.trim()) return;
    const vw = placeResultsCarouselViewportWRef.current;
    const cw = placeResultsCarouselContentWRef.current;
    if (!vw || !cw) return;
    if (cw > vw + 1) return;
    loadMorePlaceSearchRows();
  }, [loadMorePlaceSearchRows, placesListOnly, showPlaces]);

  const onPlaceSearchResultsScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!showPlaces || placesListOnly) return;
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const lw = layoutMeasurement?.width ?? 0;
      const cw = contentSize?.width ?? 0;
      if (!lw || !cw || cw <= lw) return;
      if (lw + contentOffset.x >= cw - 200) {
        loadMorePlaceSearchRows();
      }
    },
    [loadMorePlaceSearchRows, placesListOnly, showPlaces],
  );

  useEffect(() => {
    if (!showPlaces || placesListOnly) return undefined;
    const qTrim = placeQueryRef.current.trim();
    placeSearchActiveQueryTrimRef.current = qTrim;
    if (qTrim.length === 0) {
      setPlaceSearchRows([]);
      setPlaceSearchNextPageToken(null);
      setPlaceSearchErr(null);
      setPlaceSearchLoading(false);
      setPlaceSearchLastSettledQueryTrim(null);
      setPlaceThumbById({});
      return undefined;
    }
    let alive = true;
    setPlaceSearchLoading(true);
    setPlaceSearchNextPageToken(null);
    setPlaceSearchLastSettledQueryTrim(null);
    setPlaceSearchErr(null);
    void (async () => {
      try {
        const { bias, coords } = await ensureNearbySearchBias();
        if (!alive) return;
        const { places: list, nextPageToken: nxt } = await searchPlacesText(qTrim, {
          locationBias: bias,
          userCoords: coords,
          maxResultCount: PLACE_SEARCH_PAGE_SIZE,
        });
        if (!alive) return;
        setPlaceSearchRows(list);
        setPlaceSearchNextPageToken(nxt?.trim() ? nxt.trim() : null);
        setPlaceThumbById({});
      } catch (e) {
        if (!alive) return;
        setPlaceSearchRows([]);
        setPlaceSearchNextPageToken(null);
        setPlaceSearchErr(e instanceof Error ? e.message : '검색에 실패했습니다.');
      } finally {
        if (alive) {
          setPlaceSearchLoading(false);
          setPlaceSearchLastSettledQueryTrim(qTrim);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [placeSearchTriggerSeq, placesListOnly, showPlaces]);

  useEffect(() => {
    if (!onPlacesAutoAssistSnapshot) return undefined;
    if (wizardSegment !== 'places' || placesListOnly || !showPlaces) return undefined;
    const hasFilledPlace = placeCandidates.some(isFilled);
    const anyPlaceResolving = Object.values(placeResolvingById).some(Boolean);
    onPlacesAutoAssistSnapshot({
      searchLoading: placeSearchLoading,
      searchError: placeSearchErr,
      resultCount: placeSearchRows.length,
      hasFilledPlace,
      queryTrim: placeQuery.trim(),
      anyPlaceResolving,
      lastSettledQueryTrim: placeSearchLastSettledQueryTrim,
    });
    return undefined;
  }, [
    onPlacesAutoAssistSnapshot,
    wizardSegment,
    placesListOnly,
    showPlaces,
    placeSearchLoading,
    placeSearchErr,
    placeSearchRows.length,
    placeCandidates,
    placeQuery,
    placeResolvingById,
    placeSearchLastSettledQueryTrim,
  ]);

  useEffect(() => {
    if (!showPlaces || placesListOnly) return undefined;
    if (placeSearchLoading) return undefined;
    if (placeSearchErr) return undefined;
    if (placeSearchRows.length === 0) return undefined;

    const visible = placeSearchRows;
    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        for (const row of visible) {
          if (!alive) return;
          if (placeThumbById[row.id] !== undefined) continue;
          const pre = row.thumbnailUrl?.trim() ?? '';
          if (pre.startsWith('https://')) {
            setPlaceThumbById((prev) => {
              if (prev[row.id] !== undefined) return prev;
              return { ...prev, [row.id]: pre };
            });
            continue;
          }
          try {
            const thumb = await searchNaverPlaceImageThumbnail({
              title: row.title,
              roadAddress: row.roadAddress,
              address: row.address,
              category: row.category,
              preferredPhotoMediaUrl: row.thumbnailUrl ?? undefined,
              kakaoPlaceDetailPageUrl: row.link ?? undefined,
            });
            if (!alive) return;
            setPlaceThumbById((prev) => {
              if (prev[row.id] !== undefined) return prev;
              return { ...prev, [row.id]: thumb };
            });
          } catch {
            if (!alive) return;
            setPlaceThumbById((prev) => {
              if (prev[row.id] !== undefined) return prev;
              return { ...prev, [row.id]: null };
            });
          }
        }
      })();
    }, 220);

    return () => {
      alive = false;
      clearTimeout(t);
    };
    // placeThumbById는 inside에서 undefined 체크로 보호합니다(반복 effect 비용 최소화).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeSearchErr, placeSearchLoading, placeSearchRows, placesListOnly, showPlaces]);

  const renderScheduleCalendarMonthGrid = useCallback(
    (monthAnchorYmd: string, pagerPageW: number) => {
      const monthStart = dateFromYmd(monthAnchorYmd) ?? new Date();
      const year = monthStart.getFullYear();
      const month = monthStart.getMonth();
      const firstDow = new Date(year, month, 1).getDay();
      const cells: { ymd: string; day: number; inMonth: boolean }[] = [];
      const gridStart = new Date(year, month, 1 - firstDow);
      for (let i = 0; i < 42; i += 1) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        cells.push({ ymd: fmtDate(d), day: d.getDate(), inMonth: d.getMonth() === month });
      }

      const byDay: Record<string, string[]> = {};
      dateCandidates.forEach((dc) => {
        const ymd = String(dc.startDate ?? '').trim();
        const hm = String(dc.startTime ?? '').trim();
        if (!ymd) return;
        if (!byDay[ymd]) byDay[ymd] = [];
        if (hm) byDay[ymd].push(hm);
      });
      Object.keys(byDay).forEach((k) => {
        const uniq = [...new Set(byDay[k])];
        uniq.sort((a, b) => a.localeCompare(b));
        byDay[k] = uniq;
      });

      const todayYmd = fmtDate(new Date());
      const maxYmd = maxSelectableScheduleYmdLocal();
      const compactCalendar = bare && wizardSegment === 'schedule';

      return (
        <View
          key={`cal-page-${monthAnchorYmd}`}
          style={pagerPageW > 0 ? { width: pagerPageW } : { flex: 1, minWidth: 0 }}>
          <View style={styles.calendarGrid}>
            {Array.from({ length: 6 }).map((_, wi) => {
              const week = cells.slice(wi * 7, wi * 7 + 7);
              const weekHasAnyTimes = week.some((c) => (byDay[c.ymd]?.length ?? 0) > 0);
              return (
                <View
                  key={`week-${monthAnchorYmd}-${wi}`}
                  style={[
                    styles.calendarWeekRow,
                    !weekHasAnyTimes && styles.calendarWeekRowEmpty,
                    wi === 5 ? { marginBottom: 0 } : null,
                  ]}>
                  {week.map((c) => {
                    const times = byDay[c.ymd] ?? [];
                    const has = times.length > 0;
                    const lastTime = times[times.length - 1] ?? '';
                    const isPast = c.ymd < todayYmd;
                    const isAfterWindow = c.ymd > maxYmd;
                    const cellDisabled = isPast || isAfterWindow;
                    return (
                      <Pressable
                        key={c.ymd}
                        disabled={cellDisabled}
                        onPress={() => {
                          if (cellDisabled) return;
                          openTimePickerForDate(c.ymd, has ? lastTime : DEFAULT_CALENDAR_PICK_TIME, 'calendar');
                        }}
                        style={({ pressed }) => [
                          styles.calendarCell,
                          compactCalendar && styles.calendarCellCompact,
                          !weekHasAnyTimes && styles.calendarCellRowEmpty,
                          !c.inMonth && styles.calendarCellOut,
                          has && styles.calendarCellHas,
                          agentScheduleDemoHighlightYmd === c.ymd && styles.calendarCellAgentDemo,
                          cellDisabled && styles.calendarCellDisabled,
                          pressed && !cellDisabled && styles.calendarCellPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`${c.ymd}${has ? ` ${times.length}개` : ''}`}>
                        <Text
                          style={[
                            styles.calendarCellDay,
                            compactCalendar && styles.calendarCellDayCompact,
                            !c.inMonth && styles.calendarCellDayOut,
                          ]}>
                          {c.day}
                        </Text>
                        {has ? (
                          <View style={styles.calendarTimesWrap} pointerEvents="none">
                            {times.map((t) => (
                              <Text
                                key={`${c.ymd}-${t}`}
                                style={[styles.calendarCellMeta, compactCalendar && styles.calendarCellMetaCompact]}>
                                {t}
                              </Text>
                            ))}
                          </View>
                        ) : (
                          <Text
                            style={[
                              styles.calendarCellMetaEmpty,
                              compactCalendar && styles.calendarCellMetaEmptyCompact,
                            ]}
                            numberOfLines={1}>
                            {' '}
                          </Text>
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
    },
    [agentScheduleDemoHighlightYmd, bare, dateCandidates, openTimePickerForDate, wizardSegment],
  );

  const scheduleSection = (
    <>


      {!scheduleListOnly ? (
        <View style={styles.nlpSection}>
          
          <LinearGradient
            colors={[...GinitTheme.colors.brandGradient, GinitTheme.colors.ctaGradient[1]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.aiQuickInitBorder}>
            <View style={styles.aiQuickInitInner}>
              <View style={styles.voiceInputRow}>
                <TextInput
                  ref={nlpIdeaInputRef}
                  {...nlpIdeaDeferKb}
                  value={nlpScheduleInput}
                  onChangeText={setNlpScheduleInput}
                  placeholder='"내일 저녁 7시", "이번 주말 아무 때나"'
                  placeholderTextColor={INPUT_PLACEHOLDER}
                  style={[styles.aiQuickInitInput, styles.voiceInput]}
                  //multiline
                  //textAlignVertical="top"
                  returnKeyType="done"
                  blurOnSubmit={false}
                  onSubmitEditing={() => {
                    requestAnimationFrame(() => applyNlpSuggestion());
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="default"
                  inputMode="text"
                  underlineColorAndroid="transparent"
                />
                <Pressable
                  onPress={() => onPressVoiceInput('scheduleIdea')}
                  style={({ pressed }) => [styles.voiceBtn, pressed && styles.voiceBtnPressed]}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="일시 후보 음성 입력">
                  {voiceRecognizing && voiceTarget === 'scheduleIdea' ? (
                    <VoiceWaveform active color={GinitTheme.colors.primary} />
                  ) : (
                    <GinitSymbolicIcon name="mic" size={18} color={GinitTheme.colors.primary} />
                  )}
                </Pressable>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.aiPreviewRow}>
            
            {weekendPreviewSlots.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.aiPreviewScroll}>
                {weekendPreviewSlots.map((slot) => (
                  <Pressable
                    key={`${slot.ymd}-${slot.hm}`}
                    onPress={() => appendWeekendPreviewSlot(slot)}
                    style={({ pressed }) => [
                      styles.aiPreviewScheduleChip,
                      styles.aiPreviewScheduleChipCarousel,
                      pressed && styles.aiPreviewScheduleChipPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`일정 후보 추가 ${slot.ymd} ${slot.hm}`}>
                    <Text style={styles.aiPreviewScheduleChipLabel} numberOfLines={1} ellipsizeMode="tail">
                      {`${slot.ymd} · ${slot.hm}`}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : nlpParsed ? (
              <Pressable
                onPress={onPressAiPreviewParsed}
                style={({ pressed }) => [
                  styles.aiPreviewScheduleChip,
                  styles.aiPreviewScheduleChipFull,
                  pressed && styles.aiPreviewScheduleChipPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="AI 일정 프리뷰를 일정 후보로 추가">
                <Text style={styles.aiPreviewScheduleChipLabel} numberOfLines={1} ellipsizeMode="tail">
                  {(() => {
                    const c = nlpParsed.candidate;
                    const sd = String(c.startDate ?? '').trim();
                    const st = String(c.startTime ?? '').trim();
                    const datePart = sd ? sd : '날짜 미정';
                    const timePart = st ? st : '시간 미정';
                    return `${datePart} · ${timePart}`;
                  })()}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.aiPreviewScheduleChipPlaceholder}>
                <Text style={styles.aiPreviewScheduleChipHint} numberOfLines={1} ellipsizeMode="tail">
                  입력하면 AI 프리뷰가 여기에 나타나요.
                </Text>
              </View>
            )}
          </View>

          {!scheduleAiReplacesFirstCandidate && !(bare && wizardSegment === 'schedule') ? (
            <Pressable
              onPress={addDateRow}
              style={({ pressed }) => [styles.addCandidateBtn, pressed && styles.addCandidateBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="일자 후보 등록">
              <Text style={styles.addCandidateBtnLabel}>+ 일자 후보 등록</Text>
            </Pressable>
          ) : null}

          {/** 일반 일정은 AI 미리보기 카드 탭으로 추가할 수 있고, 위 버튼으로 빈 일자 행을 직접 추가할 수 있어요. (날짜 제안 모달은 첫 행만 덮어쓰므로 버튼 숨김) */}
        </View>
      ) : null}

      {(() => {
        const monthStart = dateFromYmd(calendarMonth) ?? new Date();
        const year = monthStart.getFullYear();
        const month = monthStart.getMonth();
        const monthLabel = `${year}.${pad2(month + 1)}`;
        const prevAnchor = monthStartYmd(
          fmtDate(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1)),
        );
        const nextAnchor = monthStartYmd(
          fmtDate(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)),
        );
        const pagerW = scheduleCalendarPagerW;
        const maxYmdNav = maxSelectableScheduleYmdLocal();
        const maxMonthStartNav = monthStartYmd(maxYmdNav);
        const canGoScheduleCalendarNext = monthStartYmd(nextAnchor) <= maxMonthStartNav;

        return (
          <View
            style={styles.scheduleCalendarWrap}
            onLayout={(e) => {
              const w = Math.floor(e.nativeEvent.layout.width);
              if (w <= 0) return;
              setScheduleCalendarPagerW((prev) => (Math.abs(w - prev) > 1 ? w : prev));
            }}>
            <View style={styles.scheduleCalendarHeaderRow}>
              <Pressable
                onPress={() => {
                  const prev = new Date(year, month - 1, 1);
                  setCalendarMonth(monthStartYmd(fmtDate(prev)));
                }}
                style={({ pressed }) => [styles.calendarNavBtn, pressed && styles.calendarNavBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel="이전 달">
                <GinitSymbolicIcon name="chevron-back" size={18} color={GinitTheme.colors.primary} />
              </Pressable>
              <Pressable
                onPress={() => {
                  setScheduleCalendarYmPick({ draft: new Date(year, month, 1) });
                }}
                style={({ pressed }) => [styles.scheduleCalendarTitlePress, pressed && { opacity: 0.88 }]}
                accessibilityRole="button"
                accessibilityLabel={`년·월 선택 ${monthLabel}`}>
                <Text style={styles.scheduleCalendarTitle}>{monthLabel}</Text>
              </Pressable>
              <Pressable
                disabled={!canGoScheduleCalendarNext}
                onPress={() => {
                  if (!canGoScheduleCalendarNext) return;
                  const next = new Date(year, month + 1, 1);
                  setCalendarMonth(monthStartYmd(fmtDate(next)));
                }}
                style={({ pressed }) => [
                  styles.calendarNavBtn,
                  !canGoScheduleCalendarNext && { opacity: 0.35 },
                  pressed && canGoScheduleCalendarNext && styles.calendarNavBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="다음 달">
                <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.primary} />
              </Pressable>
            </View>
            <View style={styles.calendarDowRow}>
              {WEEKDAY_KO.map((w) => (
                <Text key={w} style={styles.calendarDowText}>
                  {w}
                </Text>
              ))}
            </View>
            <View style={styles.scheduleCalendarCarouselHost}>
              <ScrollView
                ref={scheduleCalendarPagerRef}
                horizontal
                pagingEnabled
                bounces={false}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                decelerationRate="normal"
                style={styles.scheduleCalendarPagerScroll}
                contentContainerStyle={styles.scheduleCalendarPagerContent}
                onMomentumScrollEnd={(e) => {
                  if (pagerW <= 0) return;
                  if (scheduleCalendarPagerIgnoreMomentumEndRef.current) return;
                  const ix = Math.round(e.nativeEvent.contentOffset.x / pagerW);
                  if (ix === 1) return;
                  const cur = dateFromYmd(calendarMonth) ?? new Date();
                  if (ix === 0) {
                    scheduleCalendarPagerIgnoreMomentumEndRef.current = true;
                    scheduleCalendarFadeAnimRef.current?.stop?.();
                    scheduleCalendarSwipeFadeAfterRecenterRef.current = true;
                    scheduleCalendarCenterOpacity.setValue(CALENDAR_MONTH_SWIPE_TRANSITION_OPACITY);
                    setCalendarMonth(monthStartYmd(fmtDate(new Date(cur.getFullYear(), cur.getMonth() - 1, 1))));
                  } else if (ix === 2) {
                    const nxtMonthStart = monthStartYmd(
                      fmtDate(new Date(cur.getFullYear(), cur.getMonth() + 1, 1)),
                    );
                    if (nxtMonthStart > maxMonthStartNav) return;
                    scheduleCalendarPagerIgnoreMomentumEndRef.current = true;
                    scheduleCalendarFadeAnimRef.current?.stop?.();
                    scheduleCalendarSwipeFadeAfterRecenterRef.current = true;
                    scheduleCalendarCenterOpacity.setValue(CALENDAR_MONTH_SWIPE_TRANSITION_OPACITY);
                    setCalendarMonth(monthStartYmd(fmtDate(new Date(cur.getFullYear(), cur.getMonth() + 1, 1))));
                  }
                }}>
                {renderScheduleCalendarMonthGrid(prevAnchor, pagerW)}
                <Animated.View style={{ opacity: scheduleCalendarCenterOpacity }} pointerEvents="box-none">
                  {renderScheduleCalendarMonthGrid(calendarMonth, pagerW)}
                </Animated.View>
                {renderScheduleCalendarMonthGrid(nextAnchor, pagerW)}
              </ScrollView>
            </View>
          </View>
        );
      })()}

      {!(bare && wizardSegment === 'schedule') ? (
        dateCandidates.map((d, dateIndex) => (
          <DateCandidateEditorCard
            key={d.id}
            d={d}
            dateIndex={dateIndex}
            expanded={!!dateDetailExpanded[d.id]}
            onToggleExpanded={() => {
              animate();
              setDateDetailExpanded((prev) => ({ ...prev, [d.id]: !prev[d.id] }));
            }}
            canDelete={!scheduleListOnly && dateCandidates.length > 1}
            onRemove={() => removeDateRow(d.id)}
            onPatch={(patch: Partial<DateCandidate>) => updateDateRow(d.id, patch)}
            reduceHeavyEffects={reduceHeavyEffects}
            onOpenPicker={(field: DatePickerField) => openPicker(d.id, field)}
            deadlineTick={deadlineTick}
            onSubmitLastFieldInCard={
              scheduleListOnly || Platform.OS !== 'web' ? undefined : () => focusNextDateCandidateAfterWebSubmit(d.id)
            }
          />
        ))
      ) : null}
    </>
  );

  const placesInner = (
    <>
      {/* <View style={[styles.sectionHeader, wizardSegment === 'places' ? undefined : styles.sectionGap]}>
        <Text style={styles.sectionTitle}>장소 후보</Text>
      </View> */}
      <Text style={styles.sectionHint}>
        {placesListOnly
          ? '확정한 장소 후보예요. 필요하면 카드를 탭해 장소를 다시 고를 수 있어요.'
          : '검색어를 입력하면 최대 5곳까지 후보를 보여 드려요. 골랐다면 아래 확인으로 다음 단계로 넘어가 주세요.'}
      </Text>

      {!placesListOnly ? (
        <>
          <LinearGradient
            colors={[...GinitTheme.colors.brandGradient, GinitTheme.colors.ctaGradient[1]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.aiQuickInitBorder, { marginBottom: 8 }]}>
            <View style={[styles.aiQuickInitInner, { minHeight: 0, paddingVertical: 10 }]}>
              <View style={styles.voiceInputRow}>
                <TextInput
                  ref={placeQueryInputRef}
                  {...placeQueryDeferKb}
                  value={placeQuery}
                  onChangeText={(t) => {
                    if (t.trim().length > 0) placeQueryUserTouchedRef.current = true;
                    else placeQueryUserTouchedRef.current = false;
                    setPlaceQuery(t);
                  }}
                  onBlur={() => triggerPlaceSearch()}
                  onSubmitEditing={() => triggerPlaceSearch()}
                  placeholder='예: "영등포 맛집", "합정 카페"'
                  placeholderTextColor={INPUT_PLACEHOLDER}
                  style={[styles.aiQuickInitInput, styles.voiceInput, { minHeight: 0 }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  keyboardType="default"
                  inputMode="text"
                  underlineColorAndroid="transparent"
                />
                <Pressable
                  onPress={() => onPressVoiceInput('placeQuery')}
                  style={({ pressed }) => [styles.voiceBtn, pressed && styles.voiceBtnPressed]}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="장소 후보 음성 입력">
                  {voiceRecognizing && voiceTarget === 'placeQuery' ? (
                    <VoiceWaveform active color={GinitTheme.colors.primary} />
                  ) : (
                    <GinitSymbolicIcon name="mic" size={18} color={GinitTheme.colors.primary} />
                  )}
                </Pressable>
              </View>
            </View>
          </LinearGradient>

          {placeSuggestedQueries.length > 0 ? (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.placeSuggestRow}>
              {placeSuggestedQueries.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => {
                    placeQueryUserTouchedRef.current = true;
                    placeQueryRef.current = q;
                    setPlaceQuery(q);
                    triggerPlaceSearch();
                  }}
                  style={({ pressed }) => [styles.placeSuggestChip, pressed && styles.placeSuggestChipPressed]}
                  accessibilityRole="button">
                  <Text style={styles.placeSuggestChipText} numberOfLines={1}>
                    {q}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {(() => {
            const listEmpty = !placeSearchLoading && !placeSearchErr && placeSearchRows.length === 0;
            const centerEmpty = listEmpty || placeSearchLoading;
            return (
              <View style={[styles.placeResultsScrollHost, styles.placeResultsCarouselHost]}>
                <ScrollView
                  horizontal={!centerEmpty}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsHorizontalScrollIndicator={false}
                  showsVerticalScrollIndicator={false}
                  scrollEventThrottle={16}
                  onLayout={(e) => {
                    placeResultsCarouselViewportWRef.current = e.nativeEvent.layout.width;
                    requestAnimationFrame(() => maybePrefetchPlaceSearchCarousel());
                  }}
                  onContentSizeChange={(w) => {
                    placeResultsCarouselContentWRef.current = w;
                    requestAnimationFrame(() => maybePrefetchPlaceSearchCarousel());
                  }}
                  onScroll={onPlaceSearchResultsScroll}
                  style={styles.placeResultsScrollView}
                  contentContainerStyle={[
                    styles.placeResultsScrollContent,
                    styles.placeResultsCarouselContent,
                    centerEmpty && { flexGrow: 1, justifyContent: 'center', paddingVertical: 0 },
                  ]}>
                  {placeSearchLoading ? (
                    <View style={styles.placeResultsStatus}>
                      <ActivityIndicator color={GinitTheme.colors.primary} />
                      <Text style={styles.placeResultsStatusText}>검색 중…</Text>
                    </View>
                  ) : placeSearchErr ? (
                    <Text style={styles.placeResultsStatusText}>{placeSearchErr}</Text>
                  ) : listEmpty ? (
                    <Text style={styles.placeResultsStatusText}>검색 결과가 없어요.</Text>
                  ) : (
                    <>
                      {placeSearchRows.map((item) => {
                      const title = item.title;
                      const cat = (item.category ?? '').trim();
                      const addressOnly = (item.roadAddress || item.address || '').trim();
                      const selected = Boolean(placeSelectedById[item.id]);
                      const resolving = Boolean(placeResolvingById[item.id]);
                      const thumb = placeThumbById[item.id] ?? null;
                      return (
                        <View
                          key={item.id}
                          style={[
                            styles.placeResultCard,
                            styles.placeResultImageCard,
                            styles.placeResultProposalCardWrap,
                            selected && styles.placeResultImageCardSelected,
                          ]}>
                          <Pressable
                            onPress={() => {
                              if (resolving) return;
                              layoutAnimateMeetingCreateWizard();

                              if (selected) {
                                const picked = placeSelectedById[item.id];
                                setPlaceSelectedById((prev) => {
                                  const next = { ...prev };
                                  delete next[item.id];
                                  return next;
                                });
                                setPlaceCandidates((prev) => {
                                  if (!picked) {
                                    return prev.filter(
                                      (r) =>
                                        !(
                                          r.placeName === title.trim() &&
                                          r.address === (addressOnly || cat)
                                        ),
                                    );
                                  }
                                  return prev.filter(
                                    (r) => !(r.placeName === picked.placeName && r.address === picked.address),
                                  );
                                });
                                return;
                              }

                              const filledNow = placeCandidatesRef.current.filter(isFilled).length;
                              if (filledNow >= INLINE_PLACE_PICK_MAX_SELECTED) {
                                Alert.alert(
                                  '장소 후보',
                                  `검색 결과에서 최대 ${INLINE_PLACE_PICK_MAX_SELECTED}곳까지 담을 수 있어요.`,
                                );
                                return;
                              }

                              setPlaceResolvingById((prev) => ({ ...prev, [item.id]: true }));
                              void (async () => {
                                try {
                                  const resolved = await resolvePlaceSearchRowCoordinates(item);
                                  const address =
                                    resolved.roadAddress?.trim() || resolved.address?.trim() || addressOnly;
                                  if (resolved.latitude == null || resolved.longitude == null) throw new Error('좌표 없음');
                                  const placeName = resolved.title.trim() || title.trim();
                                  const linkFromApi =
                                    sanitizeNaverLocalPlaceLink(resolved.link) ?? sanitizeNaverLocalPlaceLink(item.link);
                                  const resolvedPhoto = (placeThumbById[item.id] ?? item.thumbnailUrl ?? '').trim();
                                  const preferredPhotoMediaUrl = resolvedPhoto.startsWith('https://')
                                    ? resolvedPhoto
                                    : undefined;
                                  const catPick = (resolved.category ?? item.category ?? '').trim();
                                  const p: PlaceCandidate = {
                                    id: newId('place'),
                                    placeName,
                                    address,
                                    latitude: resolved.latitude,
                                    longitude: resolved.longitude,
                                    ...(catPick ? { category: catPick } : {}),
                                    ...(linkFromApi ? { naverPlaceLink: linkFromApi } : {}),
                                    ...(preferredPhotoMediaUrl ? { preferredPhotoMediaUrl } : {}),
                                  };

                                  setPlaceSelectedById((prev) => ({ ...prev, [item.id]: { placeName, address } }));
                                  setPlaceCandidates((prev) => {
                                    const hit = prev.some((r) => r.placeName === p.placeName && r.address === p.address);
                                    if (hit) return prev;
                                    return [...prev, placeRowFromCandidate(p)];
                                  });
                                } catch (e) {
                                  setPlaceSearchErr(e instanceof Error ? e.message : '장소 추가에 실패했습니다.');
                                } finally {
                                  setPlaceResolvingById((prev) => ({ ...prev, [item.id]: false }));
                                }
                              })();
                            }}
                            style={({ pressed }) => [
                              styles.placeResultProposalPressFill,
                              pressed && styles.placeResultCardPressed,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={title}>
                            <View style={styles.placeResultProposalPressInner}>
                              <View style={styles.placeResultImageWrap}>
                                {thumb ? (
                                  <Image source={{ uri: thumb }} style={styles.placeResultImage} resizeMode="cover" />
                                ) : (
                                  <View style={styles.placeResultImageFallback} />
                                )}
                                {resolving ? (
                                  <View style={styles.placeResultImageOverlay}>
                                    <ActivityIndicator color={GinitTheme.colors.primary} />
                                  </View>
                                ) : selected ? (
                                  <View style={styles.placeResultImageOverlay}>
                                    <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                                  </View>
                                ) : null}
                              </View>
                              <Text style={styles.placeResultTitle} numberOfLines={2}>
                                {title}
                              </Text>
                              {cat ? (
                                <Text style={styles.placeResultAddr} numberOfLines={2}>
                                  {cat}
                                </Text>
                              ) : null}
                              {addressOnly ? (
                                <Text style={styles.placeResultAddr} numberOfLines={2}>
                                  {addressOnly}
                                </Text>
                              ) : null}
                            </View>
                          </Pressable>
                          <PlaceCandidateDetailLinkRow
                            title={item.title}
                            link={item.link}
                            addressLine={addressOnly || undefined}
                            disabled={resolving}
                            containerStyle={{ marginTop: 8, alignSelf: 'stretch' }}
                            onOpenUrl={(url, t) => {
                              if (onNaverPlaceWebOpen) {
                                onNaverPlaceWebOpen(url, t);
                              } else {
                                setNaverPlaceWebModal({ url, title: t });
                              }
                            }}
                          />
                        </View>
                      );
                    })}
                      {placeSearchLoadingMore ? (
                        <View style={styles.placeResultsLoadingMore}>
                          <ActivityIndicator color={GinitTheme.colors.primary} />
                        </View>
                      ) : null}
                    </>
                  )}
                </ScrollView>
              </View>
            );
          })()}
        </>
      ) : null}

      {placesListOnly && placeCandidates.length > 0 ? (
        <View style={{ marginTop: 10 }}>
          <Text style={styles.wizardFieldLabel}>선택된 장소 후보</Text>
          {placeCandidates.map((row) => (
            <View key={row.id} style={[styles.placePickedRow, styles.placeFieldRecess]}>
              <Text style={styles.placePickedName} numberOfLines={1}>
                {row.placeName}
              </Text>
              {!placesListOnly ? (
                <Pressable onPress={() => removePlaceCandidate(row.id)} accessibilityRole="button">
                  <Text style={styles.placePickedRemove}>삭제</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </>
  );

  const placesSection = (
    <View collapsable={false} onLayout={onPlacesBlockLayout}>
      {placesInner}
    </View>
  );

  const formBody = (
    <>
      {showSchedule ? scheduleSection : null}
      {showPlaces ? placesSection : null}
    </>
  );

  return (
    <>
      {bare ? (
        formBody
      ) : embedded ? (
        <View style={styles.scrollContent}>{formBody}</View>
      ) : (
        <ScrollView
          ref={dateScrollRef}
          style={GinitStyles.flexFill}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          {formBody}
        </ScrollView>
      )}

      {timePick && Platform.OS === 'android' ? (
        <DateTimePicker
          value={timePick.draft}
          mode="time"
          display="spinner"
          {...({ accentColor: GinitTheme.colors.primary } as any)}
          onChange={(event, d) => {
            const t = (event as unknown as { type?: string } | null)?.type ?? '';
            if (t === 'dismissed') {
              setTimePick(null);
              return;
            }
            if (t === 'set' && d) {
              const ymd = timePick.ymd;
              setTimePick(null);
              void commitPointCandidate(ymd, fmtTime(d));
              return;
            }
            if (!d) setTimePick(null);
          }}
        />
      ) : null}

      {timePick && Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setTimePick(null)}>
          <View style={GinitStyles.modalRoot}>
            <Pressable style={GinitStyles.modalBackdrop} onPress={() => setTimePick(null)} accessibilityRole="button" />
            <View
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                top: Math.max(insets.top, 8),
                left: 0,
                right: 0,
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
              }}>
              <Pressable onPress={() => setTimePick(null)} hitSlop={10} accessibilityRole="button">
                <Text style={GinitStyles.modalCancel}>취소</Text>
              </Pressable>
              <Pressable onPress={confirmTimePick} hitSlop={10} accessibilityRole="button">
                <Text style={GinitStyles.modalDone}>완료</Text>
              </Pressable>
            </View>
            <View
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                paddingBottom: Math.max(insets.bottom, 12),
                alignItems: 'center',
                backgroundColor: 'transparent',
              }}>
              <DateTimePicker
                value={timePick.draft}
                mode="time"
                display="spinner"
                themeVariant="light"
                locale="ko-KR"
                onChange={(_event, d) => {
                  if (!d) return;
                  setTimePick((prev) => (prev ? { ...prev, draft: d } : prev));
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      {timePick && Platform.OS !== 'android' && Platform.OS !== 'ios' ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setTimePick(null)}>
          <View style={GinitStyles.modalRoot}>
            <Pressable style={GinitStyles.modalBackdrop} onPress={() => setTimePick(null)} accessibilityRole="button" />
            <View style={[GinitStyles.modalSheet, { maxHeight: 320 }]}>
              <View style={GinitStyles.modalHeader}>
                <Pressable onPress={() => setTimePick(null)} hitSlop={10}>
                  <Text style={GinitStyles.modalCancel}>취소</Text>
                </Pressable>
                <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
                  <Text style={GinitStyles.modalTitle}>시간 선택</Text>
                  <Text style={styles.timePickHint} numberOfLines={1}>
                    {timePick.ymd}
                  </Text>
                </View>
                <Pressable onPress={confirmTimePick} hitSlop={10}>
                  <Text style={GinitStyles.modalDone}>완료</Text>
                </Pressable>
              </View>
              <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                <DateTimePicker
                  value={timePick.draft}
                  mode="time"
                  display="spinner"
                  onChange={(_event, d) => {
                    if (!d) return;
                    setTimePick((prev) => (prev ? { ...prev, draft: d } : prev));
                  }}
                />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}

      {scheduleCalendarYmPick && Platform.OS === 'android' ? (
        <DateTimePicker
          value={scheduleCalendarYmPick.draft}
          mode="date"
          display="spinner"
          minimumDate={(() => {
            const s = new Date();
            return new Date(s.getFullYear(), s.getMonth(), 1);
          })()}
          maximumDate={(() => {
            const mxd = maxSelectableScheduleDayStartLocal();
            return new Date(mxd.getFullYear(), mxd.getMonth() + 1, 0, 23, 59, 59, 999);
          })()}
          onChange={(event, date) => {
            const t = (event as unknown as { type?: string } | null)?.type ?? '';
            if (t === 'dismissed') {
              setScheduleCalendarYmPick(null);
              return;
            }
            if (t === 'set' && date) {
              setCalendarMonth(monthStartYmd(fmtDate(date)));
              setScheduleCalendarYmPick(null);
              return;
            }
            if (!date) setScheduleCalendarYmPick(null);
          }}
        />
      ) : null}

      {scheduleCalendarYmPick && Platform.OS !== 'android' ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setScheduleCalendarYmPick(null)}>
          <View style={GinitStyles.modalRoot}>
            <Pressable
              style={GinitStyles.modalBackdrop}
              onPress={() => setScheduleCalendarYmPick(null)}
              accessibilityRole="button"
            />
            <View
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                top: Math.max(insets.top, 8),
                left: 0,
                right: 0,
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
              }}>
              <Pressable onPress={() => setScheduleCalendarYmPick(null)} hitSlop={10} accessibilityRole="button">
                <Text style={GinitStyles.modalCancel}>취소</Text>
              </Pressable>
              <Pressable onPress={confirmScheduleCalendarYmPick} hitSlop={10} accessibilityRole="button">
                <Text style={GinitStyles.modalDone}>완료</Text>
              </Pressable>
            </View>
            <View
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                paddingBottom: Math.max(insets.bottom, 12),
                alignItems: 'center',
                backgroundColor: 'transparent',
              }}>
              <DateTimePicker
                value={scheduleCalendarYmPick.draft}
                mode="date"
                display="spinner"
                locale="ko-KR"
                themeVariant="light"
                minimumDate={(() => {
                  const s = new Date();
                  return new Date(s.getFullYear(), s.getMonth(), 1);
                })()}
                maximumDate={(() => {
                  const mxd = maxSelectableScheduleDayStartLocal();
                  return new Date(mxd.getFullYear(), mxd.getMonth() + 1, 0, 23, 59, 59, 999);
                })()}
                onChange={(_event: DateTimePickerEvent, date) => {
                  if (!date) return;
                  setScheduleCalendarYmPick((prev) => (prev ? { draft: date } : prev));
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      {picker && Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setPicker(null)}>
          <View style={GinitStyles.modalRoot}>
            <Pressable style={GinitStyles.modalBackdrop} onPress={() => setPicker(null)} accessibilityRole="button" />
            <View
              style={[
                GinitStyles.modalSheet,
                // 일정 후보가 1개만 등록 가능한 플로우에서는 시트가 과하게 커지며 "시트 자체 스크롤"처럼 보이는 UX가 있어 높이를 제한합니다.
                { maxHeight: Math.min(420, Math.floor(windowHeight * 0.55)), overflow: 'hidden' },
              ]}>
              <View style={GinitStyles.modalHeader}>
                <Pressable onPress={() => setPicker(null)} hitSlop={10}>
                  <Text style={GinitStyles.modalCancel}>취소</Text>
                </Pressable>
                <Text style={GinitStyles.modalTitle}>{pickerFieldLabel(picker.field)}</Text>
                <Pressable onPress={applyIosPicker} hitSlop={10}>
                  <Text style={GinitStyles.modalDone}>완료</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={iosDraft}
                mode={picker.field === 'startDate' ? 'date' : 'time'}
                display="spinner"
                onChange={(_, date) => {
                  if (date) setIosDraft(date);
                }}
                minimumDate={iosPickerMinimumDate}
                maximumDate={iosPickerMaximumDate}
                locale="ko-KR"
                themeVariant="dark"
              />
            </View>
          </View>
        </Modal>
      ) : null}

      {picker && Platform.OS === 'android' ? (
        <DateTimePicker
          value={iosDraft}
          mode={picker.field === 'startDate' ? 'date' : 'time'}
          display="spinner"
          minimumDate={iosPickerMinimumDate}
          maximumDate={iosPickerMaximumDate}
          {...({ accentColor: GinitTheme.colors.primary } as any)}
          onChange={(event: DateTimePickerEvent, date) => {
            const { rowId, field } = picker;
            setPicker(null);
            if (event.type === 'dismissed' || !date) return;
            const ymd = fmtDate(date);
            const hm = fmtTime(date);
            const dates = dateCandidatesRef.current;
            const row = dates.find((d) => d.id === rowId);
            if (!row) return;
            const idx = dates.findIndex((d) => d.id === rowId);
            const next: DateCandidate =
              field === 'startDate'
                ? { ...row, startDate: ymd }
                : field === 'startTime'
                  ? { ...row, startTime: hm }
                  : row;
            const err = validateDateCandidate(next, Math.max(0, idx));
            if (err) {
              Alert.alert('일시 확인', err);
              return;
            }
            const nextDates = dates.map((d) => (d.id === rowId ? next : d));
            void (async () => {
              if (!(await guardDateCandidatesOverlapOrAlert(nextDates))) return;
              if (field === 'startDate') updateDateRow(rowId, { startDate: ymd });
              else if (field === 'startTime') updateDateRow(rowId, { startTime: hm });
            })();
          }}
        />
      ) : null}

      {onNaverPlaceWebOpen ? null : (
        <NaverPlaceWebViewModal
          visible={naverPlaceWebModal != null}
          url={naverPlaceWebModal?.url}
          pageTitle={naverPlaceWebModal?.title ?? '장소 상세'}
          onClose={() => setNaverPlaceWebModal(null)}
        />
      )}
    </>
  );
});

export type {
  MeetingCreatePlacesAutoAssistSnapshot,
  VoteCandidatesBuildResult,
  VoteCandidatesFormProps,
  VoteCandidatesGateResult,
  VoteCandidatesFormHandle,
} from './vote-candidates-form.types';
