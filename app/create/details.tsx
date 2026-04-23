/**
 * 모임 등록 — `/create/details`: `currentStep >= n`으로 이전 단계 카드도 유지(한눈에 수정 가능).
 * 확인 버튼만 해당 단계 `currentStep === n`일 때 표시. 카테고리 변경 시 Step 1로 리셋·하위 카드 제거.
 * 일정 확정(`scheduleStep`) 후 `placesStep`에서 장소 후보 카드를 채운 뒤 상세·등록(`detailStep`)으로 이동.
 * 단계 번호(표시): 영화 …→5(일정)→6(장소)→7(상세). 비영화 …→4(일정)→5(장소)→6(상세).
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateCandidateEditorCard, type DatePickerField } from '@/components/create/DateCandidateEditorCard';
import { EarlyPlaceSearch } from '@/components/create/EarlyPlaceSearch';
import { CAPACITY_UNLIMITED, GlassDualCapacityWheel } from '@/components/create/GlassDualCapacityWheel';
import { GlassSingleCapacityWheel } from '@/components/create/GlassSingleCapacityWheel';
import { IntensityPicker } from '@/components/create/IntensityPicker';
import { MenuPreference } from '@/components/create/MenuPreference';
import { MovieSearch } from '@/components/create/MovieSearch';
import { KeyboardAwareScreenScroll } from '@/components/ui';
import { GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { layoutAnimateEaseInEaseOut } from '@/src/lib/android-layout-animation';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import { resolveSpecialtyKind, specialtyStepBadge } from '@/src/lib/category-specialty';
import {
  coerceDateCandidate,
  createPointCandidate,
  primaryScheduleFromDateCandidate,
  validateDateCandidate,
} from '@/src/lib/date-candidate';
import { stripUndefinedDeep, toFiniteInt } from '@/src/lib/firestore-utils';
import {
  buildMeetingExtraData,
  type SelectedMovieExtra,
  type SportIntensityLevel,
} from '@/src/lib/meeting-extra-data';
import type { DateCandidate, PlaceCandidate, VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import {
  consumePendingMeetingPlace,
  consumePendingVoteCandidates,
  consumePendingVotePlaceRow,
  setPendingVoteCandidates,
} from '@/src/lib/meeting-place-bridge';
import {
  generateAiMeetingDescription,
  generateSuggestedMeetingTitle,
  generateSuggestedMeetingTitles,
  getFinalDescriptionPlaceholder,
  type MeetingTitleSuggestionContext,
} from '@/src/lib/meeting-title-suggestion';
import { fetchTitleWeatherMood } from '@/src/lib/meeting-title-weather';
import { addMeeting } from '@/src/lib/meetings';
import type { PublicMeetingDetailsConfig } from '@/src/lib/meetings';
import { getUserProfile, isGoogleSnsDemographicsIncomplete } from '@/src/lib/user-profile';
import { parseSmartNaturalSchedule, type SmartNlpResult } from '@/src/lib/natural-language-schedule';
import { computeNlpApply, dateCandidateDupKey } from '@/src/lib/nlp-schedule-candidates';
import { ensureNearbySearchBias } from '@/src/lib/nearby-search-bias';
import type { NaverLocalPlace } from '@/src/lib/naver-local-search';
import { resolveNaverPlaceCoordinates, searchNaverLocalPlaces } from '@/src/lib/naver-local-search';
import { useAutoFocusOnStep } from '@/src/hooks/useAutoFocusOnStep';
import { deferSoftInputUntilUserTapProps } from '@/src/lib/defer-soft-input-until-user-tap';
import { PublicMeetingDetailsCard } from '@/components/create/PublicMeetingDetailsCard';

/** 레거시 스펙 상수(점진 제거) — 시안 톤 토큰으로 치환 */
const INPUT_PLACEHOLDER = '#94a3b8';

/** 단계 전환 시 카드가 `LayoutAnimation.Presets.easeInEaseOut` 으로 부드럽게 펼쳐지도록 설정 */
function animate() {
  layoutAnimateEaseInEaseOut();
}

/** 스택 전환 중에는 BlurView 대신 정적 View로 GPU 부하를 줄입니다. */
function VoteCandidateCard({
  reduceHeavyEffects,
  children,
  outerStyle,
}: {
  reduceHeavyEffects: boolean;
  children: ReactNode;
  outerStyle?: StyleProp<ViewStyle>;
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

function pickParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function newId(p: string) {
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtTime(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseDateTimeStrings(dateStr: string, timeStr: string): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  const now = new Date();
  if (!dm) return now;
  const y = Number(dm[1]);
  const mo = Number(dm[2]) - 1;
  const day = Number(dm[3]);
  let hh = 12;
  let mm = 0;
  if (tm) {
    hh = Number(tm[1]);
    mm = Number(tm[2]);
  }
  return new Date(y, mo, day, hh, mm, 0, 0);
}

function getPickerDraft(row: DateCandidate, field: DatePickerField): Date {
  switch (field) {
    case 'startDate':
    case 'startTime':
      return parseDateTimeStrings(row.startDate, row.startTime ?? '12:00');
    case 'endDate':
    case 'endTime':
      return parseDateTimeStrings(row.endDate ?? row.startDate, row.endTime ?? '12:00');
  }
}

function pickerFieldLabel(field: DatePickerField): string {
  switch (field) {
    case 'startDate':
      return '시작 날짜';
    case 'startTime':
      return '시작 시간';
    case 'endDate':
      return '종료 날짜';
    case 'endTime':
      return '종료 시간';
  }
}

type PlaceRowModel = {
  id: string;
  query: string;
  placeName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

function emptyPlaceRow(seedQuery = ''): PlaceRowModel {
  return {
    id: newId('place'),
    query: seedQuery,
    placeName: '',
    address: '',
    latitude: null,
    longitude: null,
  };
}

function isFilled(p: PlaceRowModel) {
  return p.latitude != null && p.longitude != null && p.placeName.trim().length > 0;
}

function placeRowFromCandidate(p: PlaceCandidate): PlaceRowModel {
  return {
    id: p.id,
    query: p.placeName,
    placeName: p.placeName,
    address: p.address,
    latitude: p.latitude,
    longitude: p.longitude,
  };
}

function buildInitialEditorState(
  initialPayload: VoteCandidatesPayload | null | undefined,
  seedQ: string,
  seedDate: string,
  seedTime: string,
): { placeCandidates: PlaceRowModel[]; dateCandidates: DateCandidate[] } {
  const hasPayload =
    (initialPayload?.placeCandidates?.length ?? 0) > 0 || (initialPayload?.dateCandidates?.length ?? 0) > 0;
  if (hasPayload && initialPayload) {
    const dateCandidates: DateCandidate[] =
      initialPayload.dateCandidates.length > 0
        ? initialPayload.dateCandidates.map((d) => {
            const c = coerceDateCandidate(d, { startDate: seedDate, startTime: seedTime });
            const raw = d as { id?: string };
            const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : newId('date');
            return { ...c, id };
          })
        : [createPointCandidate(newId('date'), seedDate, seedTime)];
    const placeCandidates =
      initialPayload.placeCandidates.length > 0
        ? initialPayload.placeCandidates.map(placeRowFromCandidate)
        : [];
    return { placeCandidates, dateCandidates };
  }
  return {
    placeCandidates: [],
    dateCandidates: [createPointCandidate(newId('date'), seedDate, seedTime)],
  };
}

// (NLP 적용 결과 타입은 `computeNlpApply` 반환 타입을 사용합니다.)

export type VoteCandidatesFormProps = {
  seedPlaceQuery?: string;
  seedScheduleDate: string;
  seedScheduleTime: string;
  /** 장소 후보 단계: AI 검색어 생성에 쓰는 테마(카테고리 라벨) */
  placeThemeLabel?: string;
  initialPayload?: VoteCandidatesPayload | null;
  embedded?: boolean;
  /** true면 부모 ScrollView 안에만 렌더(내부 스크롤·scrollTo 없음) */
  bare?: boolean;
  /** 마법사 단계별로 일정/장소 블록만 표시 (`none` = UI 없이 상태만 유지) */
  wizardSegment?: 'both' | 'schedule' | 'places' | 'none';
  /** 장소 블록 레이아웃(스크롤 앵커 등) — `layout.y`는 일정·장소 공통 래퍼 기준 */
  onPlacesBlockLayout?: (e: LayoutChangeEvent) => void;
  /** `wizardSegment`가 `places`일 때 장소 섹션 맨 위에 삽입(예: 단계 배지) */
  headerBeforePlaces?: ReactNode;
  /** true면 일정 카드 목록만 표시(자연어 입력·일정 후보 추가 버튼 숨김) — 상세 단계에서 확정 목록 유지용 */
  scheduleListOnly?: boolean;
  /** true면 장소 후보 카드는 유지하고 추가·삭제(행 2개 이상일 때)만 숨김 — 상세 단계에서 확정 장소 유지용 */
  placesListOnly?: boolean;
  /** `bare`일 때 상위 세로 스크롤 — 일정 후보 추가 시 새 카드가 보이도록 오프셋 보정 */
  parentScrollRef?: RefObject<any>;
  /** 상위 `ScrollView`의 `contentOffset.y` (onScroll로 갱신) */
  parentScrollYRef?: RefObject<number>;
};

export type VoteCandidatesBuildResult =
  | { ok: true; payload: VoteCandidatesPayload }
  | { ok: false; error: string };

export type VoteCandidatesGateResult = { ok: true } | { ok: false; error: string };

export type VoteCandidatesFormHandle = {
  buildPayload: () => VoteCandidatesBuildResult;
  validateScheduleStep: () => VoteCandidatesGateResult;
  validatePlacesStep: () => VoteCandidatesGateResult;
  /** 일정 스텝 첫 입력(자연어) 포커스 */
  focusScheduleIdeaInput: () => void;
  /** 장소 스텝 첫 입력(검색어) 포커스 */
  focusPlaceQueryInput: () => void;
  /** 첫 장소 행에 검색어를 넣고 장소 검색 화면을 열어 자동 검색·포커스 */
  openFirstPlaceSearchWithSuggestedQuery: (suggestedQuery: string) => void;
  /** 장소 검색 대기 행·모달 등 파생 UI 정리 */
  resetPlaceSearchSession: () => void;
  /** 장소 후보가 비어 있으면 등록 가능한 플레이스홀더 1행 삽입(일정 확정 후 장소 단계 생략 시) */
  ensurePlacesForWizardFinalize: () => void;
  /** 일정 확정 시점의 일시·장소를 부모 상태와 동기화하기 위해 스냅샷(장소 없으면 플레이스홀더 포함) */
  captureWizardPayloadAfterSchedule: () => VoteCandidatesBuildResult;
  /** 모임 상세「장소 제안」등 — 채워진 장소 행만 검증·스냅샷 (`dateCandidates`는 빈 배열) */
  capturePlaceCandidatesOnly: () => VoteCandidatesBuildResult;
  /** 스냅샷을 폼 내부 상태에 반영 — 리마운트 없이 buildPayload와 일치시킴 */
  applyCapturedPayload: (p: VoteCandidatesPayload) => void;
};

export const VoteCandidatesForm = forwardRef<VoteCandidatesFormHandle, VoteCandidatesFormProps>(function VoteCandidatesForm(
  {
    seedPlaceQuery = '',
    seedScheduleDate,
    seedScheduleTime,
    placeThemeLabel = '',
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
  },
  ref,
) {
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
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
  const [placeSearchRows, setPlaceSearchRows] = useState<NaverLocalPlace[]>([]);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [placeSearchErr, setPlaceSearchErr] = useState<string | null>(null);

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

  const hasDeadlineRow = useMemo(() => dateCandidates.some((d) => d.type === 'deadline'), [dateCandidates]);
  useEffect(() => {
    if (!hasDeadlineRow) return undefined;
    const i = setInterval(() => setDeadlineTick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [hasDeadlineRow]);

  useEffect(() => {
    const trimmed = nlpScheduleInput.trim();
    if (!trimmed) {
      setNlpParsed(null);
      return undefined;
    }
    const t = setTimeout(() => {
      setNlpParsed(parseSmartNaturalSchedule(trimmed, new Date()));
    }, 500);
    return () => clearTimeout(t);
  }, [nlpScheduleInput]);

  const applyNlpSuggestion = useCallback(() => {
    const trimmed = nlpScheduleInput.trim();
    const parsed = nlpParsed ?? (trimmed ? parseSmartNaturalSchedule(trimmed, new Date()) : null);
    if (!parsed) return;
    animate();
    const prev = dateCandidatesRef.current;
    const nextKey = dateCandidateDupKey({ id: 'nlp', ...(parsed.candidate as Omit<DateCandidate, 'id'>) });
    const dup = prev.some((d) => dateCandidateDupKey(d) === nextKey);
    if (dup) {
      Alert.alert('동일한 일정 후보가 있습니다.');
      requestAnimationFrame(() => {
        nlpIdeaInputRef.current?.focus?.();
      });
      return;
    }
    const { next, expandRowId, shouldAutoExpand, didAppend } = computeNlpApply(prev, parsed);
    setDateCandidates(next);
    if (shouldAutoExpand && expandRowId) {
      setDateDetailExpanded((ex) => ({ ...ex, [expandRowId]: true }));
    }
    setNlpScheduleInput('');
    setNlpParsed(null);
    // 후보를 추가/반영해도 입력 흐름이 끊기지 않게 포커스 유지
    requestAnimationFrame(() => {
      nlpIdeaInputRef.current?.focus?.();
    });
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
  }, [bare, nlpParsed, nlpScheduleInput, parentScrollRef, parentScrollYRef]);

  useImperativeHandle(
    ref,
    () => ({
      validateScheduleStep: (): VoteCandidatesGateResult => {
        const dates = dateCandidatesRef.current;
        for (let i = 0; i < dates.length; i += 1) {
          const err = validateDateCandidate(dates[i], i);
          if (err) return { ok: false, error: err };
        }
        return { ok: true };
      },
      validatePlacesStep: (): VoteCandidatesGateResult => {
        const rows = placeCandidatesRef.current;
        const filledPlaces = rows.filter(isFilled);
        if (filledPlaces.length === 0) {
          return { ok: false, error: '장소 후보를 한 곳 이상 장소 선택 화면에서 골라 주세요.' };
        }
        return { ok: true };
      },
      buildPayload: (): VoteCandidatesBuildResult => {
        const rows = placeCandidatesRef.current;
        const dates = dateCandidatesRef.current;
        const filledPlaces = rows.filter(isFilled);
        if (filledPlaces.length === 0) {
          return { ok: false, error: '장소 후보를 한 곳 이상 장소 선택 화면에서 골라 주세요.' };
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
            }) as PlaceCandidate,
        );
        const dateCandidatesOut = dates.map((d) => stripUndefinedDeep({ ...d }) as DateCandidate);
        return { ok: true, payload: { placeCandidates: placeCandidatesOut, dateCandidates: dateCandidatesOut } };
      },
      focusScheduleIdeaInput: () => {
        requestAnimationFrame(() => {
          InteractionManager.runAfterInteractions(() => {
            nlpIdeaInputRef.current?.focus?.();
          });
        });
      },
      focusPlaceQueryInput: () => {
        requestAnimationFrame(() => {
          InteractionManager.runAfterInteractions(() => {
            placeQueryInputRef.current?.focus?.();
          });
        });
      },
      openFirstPlaceSearchWithSuggestedQuery: (suggestedQuery: string) => {
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
                params: { initialQuery: q, voteRowId: r0.id },
              });
            });
          });
        });
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
            }) as PlaceCandidate,
        );
        const dateCandidatesOut = dates.map((d) => stripUndefinedDeep({ ...d }) as DateCandidate);
        return { ok: true, payload: { placeCandidates: placeCandidatesOut, dateCandidates: dateCandidatesOut } };
      },
      capturePlaceCandidatesOnly: (): VoteCandidatesBuildResult => {
        const rows = placeCandidatesRef.current;
        const filledPlaces = rows.filter(isFilled);
        if (filledPlaces.length === 0) {
          return { ok: false, error: '장소 후보를 한 곳 이상 장소 선택 화면에서 골라 주세요.' };
        }
        const placeCandidatesOut = filledPlaces.map(
          (r) =>
            stripUndefinedDeep({
              id: r.id,
              placeName: r.placeName.trim(),
              address: r.address.trim(),
              latitude: Number(r.latitude),
              longitude: Number(r.longitude),
            }) as PlaceCandidate,
        );
        return { ok: true, payload: { placeCandidates: placeCandidatesOut, dateCandidates: [] } };
      },
      applyCapturedPayload: (p: VoteCandidatesPayload) => {
        const next = buildInitialEditorState(p, seedQ, seedDate, seedTime);
        setPlaceCandidates(next.placeCandidates);
        setDateCandidates(next.dateCandidates);
      },
    }),
    [router, seedQ, seedDate, seedTime],
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
      const row: DateCandidate = last ? { ...last, id: nid } : createPointCandidate(nid, fmtDate(new Date()), '15:00');
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
    // 새 카드가 렌더된 다음 1회만 autoFocus 되도록 플래그를 정리합니다.
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

  const applyIosPicker = useCallback(() => {
    if (!picker) return;
    const { rowId, field } = picker;
    const ymd = fmtDate(iosDraft);
    const hm = fmtTime(iosDraft);
    if (field === 'startDate') updateDateRow(rowId, { startDate: ymd });
    else if (field === 'startTime') updateDateRow(rowId, { startTime: hm });
    else if (field === 'endDate') updateDateRow(rowId, { endDate: ymd });
    else updateDateRow(rowId, { endTime: hm });
    setPicker(null);
  }, [iosDraft, picker, updateDateRow]);

  const showSchedule = wizardSegment === 'both' || wizardSegment === 'schedule';
  const showPlaces = wizardSegment === 'both' || wizardSegment === 'places';

  useEffect(() => {
    if (wizardSegment !== 'schedule') return;
    if (!showSchedule) return;
    if (scheduleListOnly) return;
    // 일정 후보 등록(자연어) 카드가 생성되면 바로 입력할 수 있게 포커스
    const t = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        nlpIdeaInputRef.current?.focus?.();
      });
    }, Platform.OS === 'android' ? 140 : 80);
    return () => clearTimeout(t);
  }, [wizardSegment, showSchedule, scheduleListOnly]);

  useEffect(() => {
    if (wizardSegment !== 'places') return;
    if (!showPlaces) return;
    if (placesListOnly) return;
    // 장소 후보 등록 카드가 생성되면 검색어 입력창에 바로 포커스
    const t = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        placeQueryInputRef.current?.focus?.();
      });
    }, Platform.OS === 'android' ? 140 : 80);
    return () => clearTimeout(t);
  }, [wizardSegment, showPlaces, placesListOnly]);

  const placeThemeSeed = useMemo(() => {
    const label = (placeThemeLabel || '').trim();
    if (!label) return '맛집';
    if (label.includes('영화')) return '영화관';
    if (label.includes('카페')) return '카페';
    if (label.includes('술') || label.includes('맥주') || label.includes('바')) return '술집';
    if (label.includes('운동') || label.includes('스포츠') || label.includes('헬스')) return '운동';
    if (label.includes('전시') || label.includes('미술') || label.includes('공연')) return '전시';
    if (label.includes('산책') || label.includes('공원')) return '공원';
    if (label.includes('밥') || label.includes('식') || label.includes('맛집')) return '맛집';
    return '맛집';
  }, [placeThemeLabel]);

  const placeSuggestedQueries = useMemo(() => {
    const bias = (placeBiasHint ?? '').trim();
    const head = bias ? `${bias} ` : '';
    const base = [
      `${head}${placeThemeSeed}`,
      `${head}맛집`,
      `${head}카페`,
      `${head}데이트`,
      `${head}술집`,
    ];
    // 중복 제거 + 빈 문자열 제거
    return Array.from(new Set(base.map((s) => s.trim()).filter(Boolean))).slice(0, 5);
  }, [placeBiasHint, placeThemeSeed]);

  useEffect(() => {
    let alive = true;
    if (!showPlaces || placesListOnly) return undefined;
    void ensureNearbySearchBias().then(({ bias }) => {
      if (!alive) return;
      const b = bias?.trim() ?? null;
      setPlaceBiasHint(b);
      // 사용자가 이미 입력한 검색어가 있으면 존중
      setPlaceQuery((prev) => {
        if (prev.trim().length > 0) return prev;
        const seed = `${b ? `${b} ` : ''}${placeThemeSeed}`.trim();
        return seed;
      });
    });
    return () => {
      alive = false;
    };
  }, [placeThemeSeed, placesListOnly, showPlaces]);

  useEffect(() => {
    if (!showPlaces || placesListOnly) return undefined;
    const qTrim = placeQuery.trim();
    if (qTrim.length === 0) {
      setPlaceSearchRows([]);
      setPlaceSearchErr(null);
      setPlaceSearchLoading(false);
      return undefined;
    }
    let alive = true;
    setPlaceSearchLoading(true);
    setPlaceSearchErr(null);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const { bias } = await ensureNearbySearchBias();
          if (!alive) return;
          const list = await searchNaverLocalPlaces(qTrim, { locationBias: bias });
          if (!alive) return;
          setPlaceSearchRows(list);
        } catch (e) {
          if (!alive) return;
          setPlaceSearchRows([]);
          setPlaceSearchErr(e instanceof Error ? e.message : '검색에 실패했습니다.');
        } finally {
          if (alive) setPlaceSearchLoading(false);
        }
      })();
    }, 360);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [placeQuery, placesListOnly, showPlaces]);

  const scheduleSection = (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>일시 후보</Text>
      </View>
      <Text style={styles.sectionHint}>
        {scheduleListOnly
          ? '확정한 일시 후보예요. 필요하면 카드를 펼쳐 내용을 바꿀 수 있어요.'
          : '날짜·시간 후보를 추가하고 투표에서 고를 수 있어요.'}
      </Text>

      {!scheduleListOnly ? (
        <View style={styles.nlpSection}>
          <Text style={styles.aiQuickInitLabel}>말로 일정 아이디어를 입력해보세요</Text>
          <LinearGradient
            colors={[...GinitTheme.colors.brandGradient, GinitTheme.colors.ctaGradient[1]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.aiQuickInitBorder}>
            <View style={styles.aiQuickInitInner}>
              <TextInput
                ref={nlpIdeaInputRef}
                {...nlpIdeaDeferKb}
                value={nlpScheduleInput}
                onChangeText={setNlpScheduleInput}
                placeholder='예: "내일 저녁 7시", "이번 주말 아무 때나"'
                placeholderTextColor={INPUT_PLACEHOLDER}
                style={styles.aiQuickInitInput}
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
            </View>
          </LinearGradient>

          <View style={styles.aiPreviewRow}>
            <Text style={styles.aiPreviewHint}>AI 미리보기</Text>
            {nlpParsed ? (
              <Pressable
                onPress={applyNlpSuggestion}
                style={({ pressed }) => [
                  styles.aiPreviewCard,
                  { width: '100%' },
                  pressed && { opacity: 0.92 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="AI 일정 프리뷰를 일정 후보로 추가">
                <Text style={styles.aiPreviewTitle} numberOfLines={1} ellipsizeMode="tail">
                  {`${nlpParsed.summary} · ${nlpParsed.candidate.startDate ?? '미정'} · ${
                    nlpParsed.candidate.startTime ?? '미정'
                  }`}
                </Text>
              </Pressable>
            ) : (
              <View style={[styles.aiPreviewCardMuted, { width: '100%' }]}>
                <Text style={styles.aiPreviewEmpty} numberOfLines={1} ellipsizeMode="tail">
                  입력하면 AI 프리뷰가 여기에 나타나요.
                </Text>
              </View>
            )}
          </View>

          {/** 후보 추가는 프리뷰 카드 탭으로만 처리합니다. */}
        </View>
      ) : null}

      {dateCandidates.map((d, dateIndex) => (
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
          onPatch={(patch) => updateDateRow(d.id, patch)}
          reduceHeavyEffects={reduceHeavyEffects}
          onOpenPicker={(field) => openPicker(d.id, field)}
          deadlineTick={deadlineTick}
          autoFocusFirstInput={pendingAutoFocusDateIdRef.current === d.id}
          onSubmitLastFieldInCard={
            scheduleListOnly || Platform.OS !== 'web' ? undefined : () => focusNextDateCandidateAfterWebSubmit(d.id)
          }
        />
      ))}

      {!scheduleListOnly ? (
        <Pressable onPress={addDateRow} style={styles.addCandidateBtn} accessibilityRole="button">
          <Text style={styles.addCandidateBtnLabel}>+ 일정 후보 추가</Text>
        </Pressable>
      ) : null}
    </>
  );

  const placesInner = (
    <>
      <View style={[styles.sectionHeader, wizardSegment === 'places' ? undefined : styles.sectionGap]}>
        <Text style={styles.sectionTitle}>장소 후보</Text>
      </View>
      <Text style={styles.sectionHint}>
        {placesListOnly
          ? '확정한 장소 후보예요. 필요하면 카드를 탭해 장소를 다시 고를 수 있어요.'
          : '검색어를 입력하면 AI가 추천하는 장소 후보를 아래에서 바로 고를 수 있어요.'}
      </Text>

      {!placesListOnly ? (
        <>
          <LinearGradient
            colors={[...GinitTheme.colors.brandGradient, GinitTheme.colors.ctaGradient[1]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.aiQuickInitBorder, { marginBottom: 8 }]}>
            <View style={[styles.aiQuickInitInner, { minHeight: 0, paddingVertical: 10 }]}>
              <TextInput
                ref={placeQueryInputRef}
                {...placeQueryDeferKb}
                value={placeQuery}
                onChangeText={setPlaceQuery}
                placeholder='예: "영등포 맛집", "합정 카페"'
                placeholderTextColor={INPUT_PLACEHOLDER}
                style={[styles.aiQuickInitInput, { minHeight: 0 }]}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                keyboardType="default"
                inputMode="text"
                underlineColorAndroid="transparent"
              />
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
                  onPress={() => setPlaceQuery(q)}
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
            // 1열 리스트 기준: 후보 3개가 한 번에 보이는 높이로 고정
            const placeResultsViewportH = Math.min(420, Math.max(300, Math.round(windowHeight * 0.32)));
            const listEmpty = !placeSearchLoading && !placeSearchErr && placeSearchRows.length === 0;
            const centerEmpty = listEmpty || placeSearchLoading;
            return (
              <View style={[styles.placeResultsScrollHost, { height: placeResultsViewportH }]}>
                <ScrollView
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                  style={styles.placeResultsScrollView}
                  contentContainerStyle={[
                    styles.placeResultsScrollContent,
                    centerEmpty && {
                      flexGrow: 1,
                      minHeight: placeResultsViewportH - 4,
                      justifyContent: 'center',
                    },
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
                    <View style={styles.placeResultsGrid}>
                      {placeSearchRows.slice(0, 12).map((item) => {
                        const title = item.title;
                        const addr = (item.roadAddress || item.address || '').trim() || item.category;
                        return (
                          <Pressable
                            key={item.id}
                            onPress={() => {
                              layoutAnimateEaseInEaseOut();
                              setPlaceSearchLoading(true);
                              void (async () => {
                                try {
                                  const resolved = await resolveNaverPlaceCoordinates(item);
                                  const address = resolved.roadAddress?.trim() || resolved.address?.trim() || addr;
                                  if (resolved.latitude == null || resolved.longitude == null) throw new Error('좌표 없음');
                                  const p: PlaceCandidate = {
                                    id: newId('place'),
                                    placeName: resolved.title.trim(),
                                    address,
                                    latitude: resolved.latitude,
                                    longitude: resolved.longitude,
                                  };
                                  setPlaceCandidates((prev) => {
                                    const hit = prev.some((r) => r.placeName === p.placeName && r.address === p.address);
                                    if (hit) return prev;
                                    return [...prev, placeRowFromCandidate(p)];
                                  });
                                } catch (e) {
                                  setPlaceSearchErr(e instanceof Error ? e.message : '장소 추가에 실패했습니다.');
                                } finally {
                                  setPlaceSearchLoading(false);
                                }
                              })();
                            }}
                            style={({ pressed }) => [styles.placeResultCard, pressed && styles.placeResultCardPressed]}
                            accessibilityRole="button"
                            accessibilityLabel={title}>
                            <Text style={styles.placeResultTitle} numberOfLines={2}>
                              {title}
                            </Text>
                            <Text style={styles.placeResultAddr} numberOfLines={2}>
                              {addr}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </ScrollView>
              </View>
            );
          })()}
        </>
      ) : null}

      {placeCandidates.length > 0 ? (
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

      {picker && Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setPicker(null)}>
          <View style={GinitStyles.modalRoot}>
            <Pressable style={GinitStyles.modalBackdrop} onPress={() => setPicker(null)} accessibilityRole="button" />
            <View style={GinitStyles.modalSheet}>
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
                mode={picker.field === 'startDate' || picker.field === 'endDate' ? 'date' : 'time'}
                display={picker.field === 'startDate' || picker.field === 'endDate' ? 'inline' : 'spinner'}
                onChange={(_, date) => {
                  if (date) setIosDraft(date);
                }}
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
          mode={picker.field === 'startDate' || picker.field === 'endDate' ? 'date' : 'time'}
          display={picker.field === 'startTime' || picker.field === 'endTime' ? 'spinner' : 'default'}
          onChange={(event: DateTimePickerEvent, date) => {
            const { rowId, field } = picker;
            setPicker(null);
            if (event.type === 'dismissed' || !date) return;
            const ymd = fmtDate(date);
            const hm = fmtTime(date);
            if (field === 'startDate') updateDateRow(rowId, { startDate: ymd });
            else if (field === 'startTime') updateDateRow(rowId, { startTime: hm });
            else if (field === 'endDate') updateDateRow(rowId, { endDate: ymd });
            else updateDateRow(rowId, { endTime: hm });
          }}
        />
      ) : null}
    </>
  );
});

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export default function CreateDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useUserSession();
  const [snsDemographicsBlocked, setSnsDemographicsBlocked] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const uid = userId?.trim();
      if (!uid) {
        setSnsDemographicsBlocked(false);
        return;
      }
      let cancelled = false;
      void getUserProfile(uid).then((p) => {
        if (!cancelled) setSnsDemographicsBlocked(isGoogleSnsDemographicsIncomplete(p));
      });
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  // Android에서 BlurView(특히 experimental blur)가 children 업데이트를 늦게 반영하는 케이스가 있어
  // 즉시 피드백이 중요한 "선택 UI"는 정적 View 렌더링을 우선합니다.
  const reduceHeavyEffectsUI = Platform.OS === 'android';
  const scheduleFormRef = useRef<VoteCandidatesFormHandle>(null);
  const placesFormRef = useRef<VoteCandidatesFormHandle>(null);
  // KeyboardAwareScrollView로 래핑되므로 ref는 any로 두고 scrollTo만 사용합니다.
  const mainScrollRef = useRef<any>(null);
  /** `measureInWindow()` 가능한 메인 스크롤 호스트(View) */
  const mainScrollHostRef = useRef<View>(null);
  /** 메인 스크롤 세로 오프셋 — 영화 검색 패널 열 때 정렬에 사용 */
  const mainScrollYRef = useRef(0);
  /** 장소 단계 배지 헤더 — 화면 상단으로 스크롤 앵커 */
  const placesStepHeaderAnchorRef = useRef<View>(null);
  /** Step 3 기본 정보: 모임 이름 입력 포커스 */
  const meetingTitleInputRef = useRef<TextInput>(null);
  /** 상세 조건 단계: 소개글 입력 포커스 */
  const detailDescriptionInputRef = useRef<TextInput>(null);
  const meetingTitleDeferKb = useMemo(() => deferSoftInputUntilUserTapProps(meetingTitleInputRef), []);
  /** ScrollView 콘텐츠 기준 각 스텝 카드 상단 y (onLayout으로만 갱신) */
  const stepPositions = useRef<Partial<Record<WizardStep, number>>>({});
  /** 일정·장소 폼 래퍼의 상대 y (장소 구간 스크롤 앵커) */
  const formMountRelYRef = useRef(0);
  /** `setCurrentStep` 직후 해당 스텝 onLayout 반영 뒤 스크롤 */
  const pendingScrollAfterStepRef = useRef<WizardStep | null>(null);
  const skipNextStepLayoutAnimateRef = useRef(true);
  /** 카테고리 변경 확인 직전에 이미 layoutAnimate를 호출한 경우 중복 방지 */
  const suppressStepLayoutAnimateFromCategoryRef = useRef(false);
  /** 연속 scrollToStep 호출 시 이전 rAF·타이머 취소 */
  const scrollToStepRafRef = useRef<number | null>(null);
  const scrollToStepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    initialQuery: initialQueryParam,
    scheduleDate: scheduleDateParam,
    scheduleTime: scheduleTimeParam,
    categoryLabel: categoryLabelParam,
    categoryId: categoryIdParam,
    isPublic: isPublicParam,
  } = useLocalSearchParams<{
    initialQuery?: string | string[];
    scheduleDate?: string | string[];
    scheduleTime?: string | string[];
    categoryLabel?: string | string[];
    categoryId?: string | string[];
    isPublic?: string | string[];
  }>();

  const routeSeedQ = pickParam(initialQueryParam)?.trim() ?? '';
  const [placeSearchSeed, setPlaceSearchSeed] = useState('');
  const seedQ = (placeSearchSeed.trim() || routeSeedQ).trim();
  const seedDate = pickParam(scheduleDateParam)?.trim() || fmtDate(new Date());
  const seedTime = pickParam(scheduleTimeParam)?.trim() || '15:00';
  const paramCategoryId = pickParam(categoryIdParam)?.trim() ?? '';
  const paramCategoryLabel = pickParam(categoryLabelParam)?.trim() ?? '';

  const [categories, setCategories] = useState<Category[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [isPublicMeeting, setIsPublicMeeting] = useState(pickParam(isPublicParam) !== '0');

  const [meetingConfig, setMeetingConfig] = useState<PublicMeetingDetailsConfig>(() => {
    return {
      ageLimit: ['NONE'],
      genderRatio: 'ALL',
      settlement: 'DUTCH',
      minGLevel: 1,
      minGTrust: null,
      approvalType: 'INSTANT',
      requestMessageEnabled: null,
    };
  });

  const [title, setTitle] = useState('');
  const [minParticipants, setMinParticipants] = useState(1);
  const [maxParticipants, setMaxParticipants] = useState(4);

  const minParticipantsRef = useRef(minParticipants);
  const maxParticipantsRef = useRef(maxParticipants);
  minParticipantsRef.current = minParticipants;
  maxParticipantsRef.current = maxParticipants;

  const prevIsPublicForCapacityRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevIsPublicForCapacityRef.current;
    prevIsPublicForCapacityRef.current = isPublicMeeting;
    if (prev === null) return;
    layoutAnimateEaseInEaseOut();
    if (prev === true && isPublicMeeting === false) {
      const min = minParticipantsRef.current;
      const max = maxParticipantsRef.current;
      const n =
        max === CAPACITY_UNLIMITED || max > 100
          ? Math.min(100, Math.max(1, min))
          : Math.min(100, Math.max(1, max));
      setMinParticipants(n);
      setMaxParticipants(n);
    }
  }, [isPublicMeeting]);

  useEffect(() => {
    if (!isPublicMeeting && (minParticipants !== maxParticipants || maxParticipants === CAPACITY_UNLIMITED)) {
      const min = minParticipants;
      const max = maxParticipants;
      const n =
        max === CAPACITY_UNLIMITED || max > 100
          ? Math.min(100, Math.max(1, min))
          : Math.min(100, Math.max(1, max));
      setMinParticipants(n);
      setMaxParticipants(n);
    }
  }, [isPublicMeeting, maxParticipants, minParticipants]);

  const [description, setDescription] = useState('');
  const [descFocused, setDescFocused] = useState(false);
  const detailDescriptionDeferKb = useMemo(
    () =>
      deferSoftInputUntilUserTapProps(detailDescriptionInputRef, {
        onFocus: () => setDescFocused(true),
        onBlur: () => setDescFocused(false),
      }),
    [],
  );
  const [aiTitleSuggestions, setAiTitleSuggestions] = useState<string[]>([]);
  const [titleRegion, setTitleRegion] = useState<string | null>(null);
  const [titleWeatherMood, setTitleWeatherMood] = useState<string | null>(null);
  const titleSuggestionsGenRef = useRef(0);
  const [votePayload, setVotePayload] = useState<VoteCandidatesPayload | null>(null);
  const [voteHydrateKey, setVoteHydrateKey] = useState(0);
  const [movieCandidates, setMovieCandidates] = useState<SelectedMovieExtra[]>([]);
  /** 영화 모임: 일정 단계 이전 선행 장소 후보 */
  const [earlyPlaceCandidates, setEarlyPlaceCandidates] = useState<PlaceCandidate[]>([]);
  const [menuPreferences, setMenuPreferences] = useState<string[]>([]);
  const [sportIntensity, setSportIntensity] = useState<SportIntensityLevel>('normal');
  const [busy, setBusy] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );

  const specialtyKind = useMemo(
    () => (selectedCategory?.label ? resolveSpecialtyKind(selectedCategory.label) : null),
    [selectedCategory?.label],
  );
  const descriptionPlaceholder = useMemo(
    () =>
      getFinalDescriptionPlaceholder({
        categoryLabel: (selectedCategory?.label ?? paramCategoryLabel).trim(),
        specialtyKind,
      }),
    [paramCategoryLabel, selectedCategory?.label, specialtyKind],
  );
  const needsSpecialty = specialtyKind != null;
  const needsMovieEarlyPlaces = specialtyKind === 'movie';
  const scheduleStep: WizardStep = needsMovieEarlyPlaces ? 5 : 4;
  const placesStep: WizardStep = needsMovieEarlyPlaces ? 6 : 5;
  const detailStep: WizardStep = needsMovieEarlyPlaces ? 7 : 6;

  const resetWizardState = useCallback(() => {
    setTitle('');
    setMinParticipants(1);
    setMaxParticipants(4);
    setDescription('');
    setMovieCandidates([]);
    setEarlyPlaceCandidates([]);
    setMenuPreferences([]);
    setSportIntensity('normal');
    setVotePayload(null);
    setPlaceSearchSeed('');
    setVoteHydrateKey((k) => k + 1);
    setWizardError(null);
    setIsPublicMeeting(pickParam(isPublicParam) !== '0');
  }, [isPublicParam]);

  const requestCategorySelect = useCallback(
    (id: string) => {
      if (id === selectedCategoryId) return;
      if (currentStep > 1) {
        Alert.alert('카테고리 변경', '카테고리 변경 시 입력 내용이 초기화됩니다.', [
          { text: '취소', style: 'cancel' },
          {
            text: '확인',
            onPress: () => {
              layoutAnimateEaseInEaseOut();
              suppressStepLayoutAnimateFromCategoryRef.current = true;
              resetWizardState();
              setSelectedCategoryId(id);
              setCurrentStep(1);
              requestAnimationFrame(() => {
                mainScrollRef.current?.scrollTo({ y: 0, animated: true });
              });
            },
          },
        ]);
        return;
      }
      // Step 1에서는 선택 즉시 UI가 바뀌도록 애니메이션으로 피드백을 강화합니다.
      layoutAnimateEaseInEaseOut();
      setSelectedCategoryId(id);
    },
    [currentStep, resetWizardState, selectedCategoryId],
  );

  const screenTitle = useMemo(
    () => (selectedCategory?.label ? `${selectedCategory.label}  약속 잡기` : '약속 잡기'),
    [selectedCategory?.label],
  );

  useEffect(() => {
    setCatLoading(true);
    const unsub = subscribeCategories(
      (list) => {
        setCategories(list);
        setCatError(null);
        setCatLoading(false);
        setSelectedCategoryId((prev) => {
          if (paramCategoryId && list.some((c) => c.id === paramCategoryId)) return paramCategoryId;
          if (prev && list.some((c) => c.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      },
      (msg) => {
        setCatError(msg);
        setCatLoading(false);
      },
    );
    return unsub;
  }, [paramCategoryId]);

  useFocusEffect(
    useCallback(() => {
      // 포커스마다 scrollTo(0) 하지 않음 — 장소 검색(`/place-search`)에서 돌아올 때 스크롤 위치 유지
      const mp = consumePendingMeetingPlace();
      if (mp?.placeName?.trim()) {
        setPlaceSearchSeed(mp.placeName.trim());
      }
      const v = consumePendingVoteCandidates();
      if (v) {
        setVotePayload(v);
        setVoteHydrateKey((k) => k + 1);
      }
    }, []),
  );

  useEffect(() => {
    const label = selectedCategory?.label?.trim() ?? paramCategoryLabel.trim();
    if (!label) {
      setAiTitleSuggestions([]);
      setTitleRegion(null);
      setTitleWeatherMood(null);
      return;
    }
    const gen = ++titleSuggestionsGenRef.current;
    let alive = true;
    void (async () => {
      try {
        const { bias, coords } = await ensureNearbySearchBias();
        let weather: string | null = null;
        if (coords) {
          weather = await fetchTitleWeatherMood(coords);
        }
        if (!alive || gen !== titleSuggestionsGenRef.current) return;
        const region = bias?.trim() ?? null;
        setTitleRegion(region);
        setTitleWeatherMood(weather);
        const ctx: MeetingTitleSuggestionContext = { regionLabel: region, weatherMood: weather };
        setAiTitleSuggestions(generateSuggestedMeetingTitles(label, new Date(), 5, ctx));
      } catch {
        if (!alive || gen !== titleSuggestionsGenRef.current) return;
        setTitleRegion(null);
        setTitleWeatherMood(null);
        /** 위치·날씨 실패 시에도 오류 문구 없이 지역/날씨 없는 캐주얼 추천만 생성 */
        setAiTitleSuggestions(generateSuggestedMeetingTitles(label, new Date(), 5, {}));
      }
    })();
    return () => {
      alive = false;
    };
  }, [paramCategoryLabel, selectedCategory?.label]);

  const titleSuggestionCtx = useMemo(
    (): MeetingTitleSuggestionContext => ({
      regionLabel: titleRegion,
      weatherMood: titleWeatherMood,
    }),
    [titleRegion, titleWeatherMood],
  );

  /** 직접 입력이 없으면 AI 추천 첫 항목 → 없으면 카테고리 기반 한 줄 생성 */
  const effectiveMeetingTitle = useMemo(() => {
    const manual = title.trim();
    if (manual.length > 0) return manual;
    const firstAi = aiTitleSuggestions[0]?.trim() ?? '';
    if (firstAi.length > 0) return firstAi;
    const label = (selectedCategory?.label?.trim() ?? paramCategoryLabel.trim()) || '모임';
    return generateSuggestedMeetingTitle(label, new Date(), 0, titleSuggestionCtx);
  }, [title, aiTitleSuggestions, selectedCategory?.label, paramCategoryLabel, titleSuggestionCtx]);

  /**
   * 레이아웃 변화(LayoutAnimation)와 스크롤을 다른 프레임으로 분리.
   */
  const alignPlacesStepHeaderToTop = useCallback(() => {
    const scrollView = mainScrollRef.current;
    const scrollHost = mainScrollHostRef.current;
    const anchor = placesStepHeaderAnchorRef.current;
    if (!scrollView || !scrollHost || !anchor) return;
    anchor.measureInWindow((hx: number, hy: number, _hw: number, _hh: number) => {
      scrollHost.measureInWindow((sx: number, sy: number, _sw: number, _sh: number) => {
        const scrollY = mainScrollYRef.current;
        const pad = Platform.OS === 'android' ? 10 : 8;
        const nextY = Math.max(0, scrollY + (hy - sy) - pad);
        if (typeof scrollView.scrollTo === 'function') {
          scrollView.scrollTo({ y: nextY, animated: true });
        } else if (typeof scrollView.scrollToPosition === 'function') {
          scrollView.scrollToPosition(0, nextY, true);
        }
      });
    });
  }, []);

  const scrollToStep = useCallback((s: WizardStep) => {
    const y = stepPositions.current[s];
    if (y == null || !mainScrollRef.current) return;
    // 장소 후보 카드(placesStep)는 가능한 화면 상단에 붙여 보여야 해서 여백을 최소화합니다.
    const topPad = s === placesStep ? 4 : 20;
    const targetY = Math.max(0, y - topPad);

    if (scrollToStepRafRef.current != null) {
      cancelAnimationFrame(scrollToStepRafRef.current);
      scrollToStepRafRef.current = null;
    }
    if (scrollToStepTimerRef.current) {
      clearTimeout(scrollToStepTimerRef.current);
      scrollToStepTimerRef.current = null;
    }

    layoutAnimateEaseInEaseOut();

    scrollToStepRafRef.current = requestAnimationFrame(() => {
      scrollToStepRafRef.current = null;
      const postFrameMs = Platform.OS === 'android' ? 100 : 48;
      scrollToStepTimerRef.current = setTimeout(() => {
        scrollToStepTimerRef.current = null;
        const scroller = mainScrollRef.current as any;
        if (typeof scroller?.scrollToPosition === 'function') {
          scroller.scrollToPosition(0, targetY, true);
          return;
        }
        scroller?.scrollTo?.({ y: targetY, animated: true });
      }, postFrameMs);
    });
  }, [placesStep]);

  useEffect(() => {
    if (skipNextStepLayoutAnimateRef.current) {
      skipNextStepLayoutAnimateRef.current = false;
      return;
    }
    if (suppressStepLayoutAnimateFromCategoryRef.current) {
      suppressStepLayoutAnimateFromCategoryRef.current = false;
      return;
    }
    layoutAnimateEaseInEaseOut();
  }, [currentStep]);

  useAutoFocusOnStep({
    enabled: !busy && currentStep === 3,
    targetRef: meetingTitleInputRef,
  });

  useEffect(() => {
    if (busy) return;
    if (currentStep !== scheduleStep) return;
    // 스텝 헤더를 위로 올린 뒤 첫 입력에 포커스
    scrollToStep(scheduleStep);
    const t = setTimeout(() => {
      scheduleFormRef.current?.focusScheduleIdeaInput?.();
    }, Platform.OS === 'android' ? 140 : 80);
    return () => clearTimeout(t);
  }, [busy, currentStep, scheduleStep, scrollToStep]);

  useEffect(() => {
    if (busy) return;
    if (currentStep !== placesStep) return;
    scrollToStep(placesStep);
    const t = setTimeout(() => {
      placesFormRef.current?.focusPlaceQueryInput?.();
    }, Platform.OS === 'android' ? 160 : 90);
    return () => clearTimeout(t);
  }, [busy, currentStep, placesStep, scrollToStep]);

  useAutoFocusOnStep({
    enabled: !busy && currentStep === detailStep,
    targetRef: detailDescriptionInputRef,
  });

  useEffect(() => {
    const target = pendingScrollAfterStepRef.current;
    if (target == null || target !== currentStep) return;
    pendingScrollAfterStepRef.current = null;
    const id = setTimeout(() => {
      scrollToStep(target);
    }, 48);
    return () => clearTimeout(id);
  }, [currentStep, scrollToStep]);

  /** 장소 후보 단계: 단계 타이틀(배지)이 화면 최상단에 오도록 보정 — 레이아웃·검색 데이터 지연에 맞춰 재시도 */
  useEffect(() => {
    if (currentStep !== placesStep) return;
    let cancelled = false;
    let t1: ReturnType<typeof setTimeout> | null = null;
    let t2: ReturnType<typeof setTimeout> | null = null;
    let t3: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      if (!cancelled) alignPlacesStepHeaderToTop();
    };
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      t1 = setTimeout(run, Platform.OS === 'android' ? 100 : 56);
      t2 = setTimeout(run, Platform.OS === 'android' ? 280 : 200);
      t3 = setTimeout(run, Platform.OS === 'android' ? 520 : 380);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
      if (t3) clearTimeout(t3);
    };
  }, [currentStep, placesStep, alignPlacesStepHeaderToTop]);

  useEffect(
    () => () => {
      if (scrollToStepRafRef.current != null) {
        cancelAnimationFrame(scrollToStepRafRef.current);
        scrollToStepRafRef.current = null;
      }
      if (scrollToStepTimerRef.current) {
        clearTimeout(scrollToStepTimerRef.current);
        scrollToStepTimerRef.current = null;
      }
    },
    [],
  );

  const captureStepPosition = useCallback((s: WizardStep, e: LayoutChangeEvent) => {
    stepPositions.current[s] = e.nativeEvent.layout.y;
  }, []);

  const onPlacesBlockLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const ySched = stepPositions.current[scheduleStep];
      if (ySched == null) return;
      stepPositions.current[placesStep] = ySched + formMountRelYRef.current + e.nativeEvent.layout.y;
    },
    [placesStep, scheduleStep],
  );

  // (VoteCandidatesForm 안에서 사용하는 headerBeforePlaces는 현재 사용하지 않습니다.)

  const onMinParticipantsChange = useCallback((n: number) => {
    setMinParticipants(n);
    setMaxParticipants((m) => (m < n ? n : m));
  }, []);

  const onMaxParticipantsChange = useCallback((n: number) => {
    setMaxParticipants(n);
  }, []);

  const onPrivateAttendeesChange = useCallback((n: number) => {
    setMinParticipants(n);
    setMaxParticipants(n);
  }, []);

  const onStep1Next = useCallback(() => {
    setWizardError(null);
    if (!selectedCategoryId || !selectedCategory) {
      setWizardError('카테고리를 선택해 주세요.');
      return;
    }
    if (needsSpecialty) {
      pendingScrollAfterStepRef.current = 2;
      setCurrentStep(2);
    } else {
      pendingScrollAfterStepRef.current = 3;
      setCurrentStep(3);
    }
  }, [needsSpecialty, selectedCategory, selectedCategoryId]);

  const onStep2SpecialtyNext = useCallback(() => {
    setWizardError(null);
    if (specialtyKind === 'movie' && movieCandidates.length === 0) {
      setWizardError('영화 후보를 한 개 이상 선택해 주세요.');
      return;
    }
    if (specialtyKind === 'food' && menuPreferences.length === 0) {
      setWizardError('메뉴 성향을 한 가지 이상 선택해 주세요.');
      return;
    }
    pendingScrollAfterStepRef.current = 3;
    setCurrentStep(3);
  }, [menuPreferences.length, movieCandidates.length, specialtyKind]);

  const onStep3BasicNext = useCallback(() => {
    setWizardError(null);
    if (!title.trim()) {
      setTitle(effectiveMeetingTitle);
    }
    if (isPublicMeeting) {
      if (!Number.isFinite(minParticipants) || minParticipants < 1 || minParticipants > 100) {
        setWizardError('최소 인원을 선택해 주세요.');
        return;
      }
      if (
        !Number.isFinite(maxParticipants) ||
        maxParticipants < 1 ||
        maxParticipants < minParticipants ||
        (maxParticipants > 100 && maxParticipants !== CAPACITY_UNLIMITED)
      ) {
        setWizardError('최대 인원을 선택해 주세요.');
        return;
      }
    } else {
      if (
        !Number.isFinite(minParticipants) ||
        minParticipants < 1 ||
        minParticipants > 100 ||
        minParticipants !== maxParticipants ||
        maxParticipants === CAPACITY_UNLIMITED
      ) {
        setWizardError('참석 인원을 선택해 주세요.');
        return;
      }
    }
    pendingScrollAfterStepRef.current = 4;
    setCurrentStep(4);
  }, [effectiveMeetingTitle, isPublicMeeting, maxParticipants, minParticipants, title]);

  const onEarlyPlacesFloatingConfirm = useCallback(() => {
    setWizardError(null);
    if (earlyPlaceCandidates.length === 0) {
      setWizardError('장소 후보를 한 곳 이상 선택해 주세요.');
      scrollToStep(4);
      return;
    }
    animate();
    setVotePayload({
      placeCandidates: earlyPlaceCandidates.map((p) => ({
        id: p.id,
        placeName: p.placeName,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
      })),
      dateCandidates:
        votePayload?.dateCandidates && votePayload.dateCandidates.length > 0
          ? votePayload.dateCandidates.map((d) => ({ ...d }))
          : [createPointCandidate(newId('date'), seedDate, seedTime)],
    });
    setVoteHydrateKey((k) => k + 1);
    pendingScrollAfterStepRef.current = scheduleStep;
    setCurrentStep(scheduleStep);
  }, [earlyPlaceCandidates, scrollToStep, scheduleStep, seedDate, seedTime, votePayload?.dateCandidates]);

  const handleConfirmSchedule = useCallback(() => {
    setWizardError(null);
    const r = scheduleFormRef.current?.validateScheduleStep();
    if (!r?.ok) {
      setWizardError(r?.error ?? '일정 후보를 확인해 주세요.');
      return;
    }
    const cap = scheduleFormRef.current?.captureWizardPayloadAfterSchedule();
    if (!cap || !cap.ok) {
      setWizardError(cap && !cap.ok ? cap.error : '일정·장소 데이터를 저장하지 못했어요.');
      return;
    }
    scheduleFormRef.current?.applyCapturedPayload(cap.payload);
    setVotePayload(cap.payload);
    setPlaceSearchSeed('');
    scheduleFormRef.current?.resetPlaceSearchSession();
    setCurrentStep(placesStep);
  }, [placesStep]);

  const onPlacesStepConfirm = useCallback(() => {
    setWizardError(null);
    const r = placesFormRef.current?.validatePlacesStep();
    if (!r?.ok) {
      setWizardError(r?.error ?? '장소 후보를 확인해 주세요.');
      return;
    }
    pendingScrollAfterStepRef.current = detailStep;
    setCurrentStep(detailStep);
  }, [detailStep]);

  const handleBack = useCallback(() => {
    const r = (placesFormRef.current ?? scheduleFormRef.current)?.buildPayload();
    if (r?.ok) {
      setPendingVoteCandidates(r.payload);
    }
    router.back();
  }, [router]);

  const onFinalRegister = useCallback(async () => {
    setWizardError(null);
    const cid = selectedCategory?.id?.trim() ?? '';
    const clabel = selectedCategory?.label?.trim() ?? '';
    if (!cid || !clabel) {
      Alert.alert('오류', '카테고리를 선택해 주세요.');
      return;
    }
    if (isPublicMeeting) {
      if (!Number.isFinite(minParticipants) || minParticipants < 1 || minParticipants > 100) {
        setWizardError('최소 인원을 선택해 주세요.');
        Alert.alert('입력 확인', '최소 인원을 선택해 주세요.');
        return;
      }
      if (
        !Number.isFinite(maxParticipants) ||
        maxParticipants < 1 ||
        maxParticipants < minParticipants ||
        (maxParticipants > 100 && maxParticipants !== CAPACITY_UNLIMITED)
      ) {
        setWizardError('최대 인원을 선택해 주세요.');
        Alert.alert('입력 확인', '최대 인원을 선택해 주세요.');
        return;
      }
    } else {
      if (
        !Number.isFinite(minParticipants) ||
        minParticipants < 1 ||
        minParticipants > 100 ||
        minParticipants !== maxParticipants ||
        maxParticipants === CAPACITY_UNLIMITED
      ) {
        setWizardError('참석 인원을 선택해 주세요.');
        Alert.alert('입력 확인', '참석 인원을 선택해 주세요.');
        return;
      }
    }
    if (specialtyKind === 'movie' && movieCandidates.length === 0) {
      setWizardError('영화 후보를 한 개 이상 선택해 주세요.');
      Alert.alert('입력 확인', '영화 후보를 한 개 이상 선택해 주세요.');
      return;
    }
    if (specialtyKind === 'food' && menuPreferences.length === 0) {
      setWizardError('메뉴 성향을 한 가지 이상 선택해 주세요.');
      Alert.alert('입력 확인', '메뉴 성향을 한 가지 이상 선택해 주세요.');
      return;
    }
    const built = (placesFormRef.current ?? scheduleFormRef.current)?.buildPayload();
    if (!built?.ok) {
      setWizardError(built?.error ?? '일시·장소 후보를 확인해 주세요.');
      Alert.alert('입력 확인', built?.error ?? '일시·장소 후보를 확인해 주세요.');
      return;
    }
    if (!userId?.trim()) {
      Alert.alert('전화번호 필요', '모임을 등록하려면 로그인 화면에서 전화번호로 시작해 주세요.');
      router.replace('/login');
      return;
    }

    try {
      const prof = await getUserProfile(userId.trim());
      if (isGoogleSnsDemographicsIncomplete(prof)) {
        Alert.alert(
          '프로필을 먼저 완성해 주세요',
          'SNS 간편 가입 계정은 프로필에서 성별과 연령대를 입력한 뒤 모임을 만들 수 있어요.',
          [{ text: '프로필로 이동', onPress: () => router.push('/(tabs)/profile') }],
        );
        return;
      }
    } catch {
      /* 네트워크 오류 시에는 등록 시도는 계속(서버/클라이언트 재검증) */
    }

    const vote = built.payload;
    const p0 = vote.placeCandidates[0];
    const primary = primaryScheduleFromDateCandidate(vote.dateCandidates[0]);

    const meetingTitleForSave = effectiveMeetingTitle.trim();
    const descTrim = description.trim();
    const descriptionForSave =
      descTrim.length > 0
        ? descTrim
        : generateAiMeetingDescription({
            categoryLabel: clabel,
            meetingTitle: meetingTitleForSave,
            placeName: p0.placeName.trim(),
            scheduleDate: primary.scheduleDate.trim(),
            scheduleTime: primary.scheduleTime.trim(),
            movieTitles: specialtyKind === 'movie' ? movieCandidates.map((m) => m.title) : undefined,
            isPublic: isPublicMeeting,
          });

    const extraData =
      specialtyKind != null
        ? buildMeetingExtraData({
            kind: specialtyKind,
            movies: movieCandidates,
            menuPreferences,
            sportIntensity,
          })
        : null;

    const lat = Number(p0.latitude);
    const lng = Number(p0.longitude);
    const cap = toFiniteInt(maxParticipants, 1);
    const minP = toFiniteInt(minParticipants, 1);

    setBusy(true);
    try {
      const createdMeetingId = await addMeeting({
        title: meetingTitleForSave,
        location: p0.placeName.trim(),
        placeName: p0.placeName.trim(),
        address: p0.address.trim(),
        latitude: Number.isFinite(lat) ? lat : 0,
        longitude: Number.isFinite(lng) ? lng : 0,
        description: descriptionForSave,
        capacity: cap,
        minParticipants: minP,
        createdBy: userId.trim(),
        categoryId: cid,
        categoryLabel: clabel,
        isPublic: isPublicMeeting,
        scheduleDate: primary.scheduleDate.trim(),
        scheduleTime: primary.scheduleTime.trim(),
        placeCandidates: vote.placeCandidates,
        dateCandidates: vote.dateCandidates,
        extraData,
        meetingConfig: isPublicMeeting ? meetingConfig : null,
      });
      router.replace(`/meeting/${createdMeetingId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      setWizardError(msg);
      Alert.alert('등록 실패', msg);
    } finally {
      setBusy(false);
    }
  }, [
    description,
    effectiveMeetingTitle,
    isPublicMeeting,
    maxParticipants,
    minParticipants,
    userId,
    router,
    selectedCategory?.id,
    selectedCategory?.label,
    specialtyKind,
    movieCandidates,
    menuPreferences,
    sportIntensity,
    meetingConfig,
  ]);

  /** 등록 버튼: 로딩 중만 비활성화. 소개글 길이는 눌렀을 때 검증(짧으면 안내). */
  const finalDisabled = busy;

  return (
    <View style={styles.screenRoot}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <View style={styles.topBarRow}>
            <Pressable onPress={handleBack} hitSlop={12} accessibilityRole="button">
              <Text style={styles.backLink}>← 닫기</Text>
            </Pressable>
            <Text style={styles.screenTitle} numberOfLines={1}>
              {screenTitle}
            </Text>
            <View style={{ width: 56 }} />
          </View>

          {snsDemographicsBlocked ? (
            <View style={styles.snsGateBanner}>
              <Text style={styles.snsGateTitle}>프로필에 성별·연령대를 입력해 주세요</Text>
              <Text style={styles.snsGateBody}>
                SNS 간편 가입 계정은 프로필에서 입력을 마친 뒤 모임을 만들 수 있어요. 앱 소개 투어는 그대로 이용할 수 있어요.
              </Text>
              <Pressable
                onPress={() => router.push('/(tabs)/profile')}
                style={({ pressed }) => [styles.snsGateBtn, pressed && { opacity: 0.88 }]}
                accessibilityRole="button"
                accessibilityLabel="프로필 탭으로 이동">
                <Text style={styles.snsGateBtnLabel}>프로필로 이동</Text>
              </Pressable>
            </View>
          ) : null}

          <View ref={mainScrollHostRef} collapsable={false} style={GinitStyles.flexFill}>
            <KeyboardAwareScreenScroll
              ref={mainScrollRef}
              style={GinitStyles.flexFill}
              extraScrollHeight={28}
              extraHeight={Math.max(0, insets.bottom) + 120}
              scrollProps={{
                nestedScrollEnabled: true,
                overScrollMode: 'never',
                showsVerticalScrollIndicator: false,
                removeClippedSubviews: false,
                keyboardShouldPersistTaps: 'handled',
                scrollEventThrottle: 1,
                onScroll: (e) => {
                  mainScrollYRef.current = e.nativeEvent.contentOffset.y;
                },
                decelerationRate: 'normal',
              }}
              contentContainerStyle={[
                styles.scrollContent,
                styles.wizardScrollPad,
                needsMovieEarlyPlaces &&
                  currentStep === 4 && { paddingBottom: 110 + insets.bottom },
                currentStep === detailStep && { paddingBottom: 108 + insets.bottom },
              ]}>
              <View collapsable={false}>
              <View style={styles.wizardStepShell} onLayout={(e) => captureStepPosition(1, e)}>
                <Text style={styles.wizardStepBadge}>모임 성격</Text>
                <Text style={styles.wizardHeroHint}>어떤 모임인지 골라 주세요. 언제든 바꿀 수 있어요.</Text>

                {catLoading ? (
                  <View style={styles.centerRow}>
                    <ActivityIndicator color={GinitTheme.colors.primary} />
                    <Text style={styles.wizardMuted}>카테고리 불러오는 중…</Text>
                  </View>
                ) : null}
                {catError ? (
                  <View style={styles.warnBox}>
                    <Text style={styles.warnTitle}>카테고리를 불러오지 못했어요</Text>
                    <Text style={styles.warnBody}>{catError}</Text>
                  </View>
                ) : null}
                {!catLoading && !catError && categories.length === 0 ? (
                  <Text style={styles.wizardMuted}>등록된 카테고리가 없습니다. Firestore `categories`를 확인해 주세요.</Text>
                ) : null}

                <View style={styles.catGrid}>
                  {categories.map((c) => {
                    const active = c.id === selectedCategoryId;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => requestCategorySelect(c.id)}
                        style={({ pressed }) => [
                          styles.catTile,
                          active && styles.catTileActive,
                          pressed && styles.catTilePressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}>
                        <Text style={styles.catEmoji}>{c.emoji}</Text>
                        <Text style={styles.catLabel} numberOfLines={2}>
                          {c.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.wizardFieldLabel, { marginTop: 18 }]}>공개 / 비공개</Text>
                <VoteCandidateCard reduceHeavyEffects={reduceHeavyEffectsUI} outerStyle={styles.wizardGlassCard}>
                  <View style={styles.segmentRow}>
                    <Pressable
                      onPress={() => setIsPublicMeeting(false)}
                      style={[styles.segmentHalf, !isPublicMeeting && styles.segmentHalfOnPrivate]}
                      accessibilityRole="button">
                      <Text style={[styles.segmentTitle, !isPublicMeeting && styles.segmentTitleOn]}>🔒 비공개</Text>
                      <Text style={styles.segmentSub}>(초대만)</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setIsPublicMeeting(true)}
                      style={[styles.segmentHalf, isPublicMeeting && styles.segmentHalfOnPublic]}
                      accessibilityRole="button">
                      <Text style={[styles.segmentTitle, isPublicMeeting && styles.segmentTitleOn]}>🌐 공개</Text>
                      <Text style={styles.segmentSub}>(지역 검색)</Text>
                    </Pressable>
                  </View>
                </VoteCandidateCard>

                {currentStep === 1 ? (
                  <Pressable
                    onPress={onStep1Next}
                    disabled={!selectedCategoryId || categories.length === 0}
                    style={({ pressed }) => [
                      styles.wizardPrimaryBtn,
                      (!selectedCategoryId || categories.length === 0) && styles.addCandidateBtnDisabled,
                      pressed && selectedCategoryId && categories.length > 0 && styles.addCandidateBtnPressed,
                    ]}
                    accessibilityRole="button">
                    <View pointerEvents="none" style={styles.wizardPrimaryBtnBg}>
                      <LinearGradient
                        colors={GinitTheme.colors.ctaGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFillObject}
                      />
                    </View>
                    <Text style={styles.wizardPrimaryBtnLabel}>
                      {needsSpecialty ? '확인' : '확인'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {selectedCategory != null && needsSpecialty && specialtyKind && currentStep >= 2 ? (
                <View style={styles.wizardStepShell} onLayout={(e) => captureStepPosition(2, e)}>
                  <Text style={[styles.wizardStepBadge, { marginTop: 0 }]}>{specialtyStepBadge(specialtyKind)}</Text>
                  <Text style={styles.wizardLockedHint}>카테고리에 맞춰 선택해 주세요.</Text>
                  <VoteCandidateCard reduceHeavyEffects={reduceHeavyEffectsUI} outerStyle={styles.wizardGlassCard}>
                    {specialtyKind === 'movie' ? (
                      <MovieSearch
                        value={movieCandidates}
                        onChange={setMovieCandidates}
                        disabled={busy}
                        parentScrollRef={mainScrollRef}
                        parentScrollYRef={mainScrollYRef}
                        autoFocusSearch={!busy && currentStep === 2}
                      />
                    ) : null}
                    {specialtyKind === 'food' ? (
                      <MenuPreference value={menuPreferences} onChange={setMenuPreferences} disabled={busy} />
                    ) : null}
                    {specialtyKind === 'sports' ? (
                      <IntensityPicker value={sportIntensity} onChange={setSportIntensity} disabled={busy} />
                    ) : null}
                  </VoteCandidateCard>
                  {currentStep === 2 ? (
                    <Pressable
                      onPress={onStep2SpecialtyNext}
                      disabled={
                        busy ||
                        (specialtyKind === 'movie' && movieCandidates.length === 0)
                      }
                      style={({ pressed }) => [
                        styles.wizardPrimaryBtn,
                        specialtyKind === 'movie' &&
                          movieCandidates.length === 0 &&
                          styles.addCandidateBtnDisabled,
                        pressed &&
                          !(specialtyKind === 'movie' && movieCandidates.length === 0) &&
                          styles.addCandidateBtnPressed,
                      ]}
                      accessibilityRole="button">
                      <View pointerEvents="none" style={styles.wizardPrimaryBtnBg}>
                        <LinearGradient
                          colors={GinitTheme.colors.ctaGradient}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={StyleSheet.absoluteFillObject}
                        />
                      </View>
                      <Text style={styles.wizardPrimaryBtnLabel}>
                        {specialtyKind === 'movie'
                          ? '이 후보들로 모임 만들기'
                          : '확인 · 기본 정보'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {currentStep >= 3 ? (
                <View style={styles.wizardStepShell} onLayout={(e) => captureStepPosition(3, e)}>
                  <Text style={styles.wizardStepBadge}>기본 정보</Text>
                  <VoteCandidateCard reduceHeavyEffects={reduceHeavyEffectsUI} outerStyle={styles.wizardGlassCard}>
                    <Text style={styles.wizardFieldLabel}>모임 이름</Text>
                    <LinearGradient
                      colors={[...GinitTheme.colors.brandGradient, GinitTheme.colors.ctaGradient[1]]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[styles.aiQuickInitBorder, { marginBottom: 0 }]}>
                      <View style={[styles.aiQuickInitInner, { minHeight: 0, paddingVertical: 10 }]}>
                        <TextInput
                          ref={meetingTitleInputRef}
                          {...meetingTitleDeferKb}
                          value={title}
                          onChangeText={setTitle}
                          placeholder={
                            aiTitleSuggestions[0] ? `예: ${aiTitleSuggestions[0]}` : '모임 이름을 입력하세요'
                          }
                          placeholderTextColor={INPUT_PLACEHOLDER}
                          style={[styles.aiQuickInitInput, { minHeight: 0 }]}
                          editable={!busy}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="default"
                          inputMode="text"
                          underlineColorAndroid="transparent"
                        />
                      </View>
                    </LinearGradient>
                    <Text style={[styles.wizardFieldHint, { marginTop: 6 }]}>
                      비워 두면 AI 추천(또는 자동 생성) 제목이 등록됩니다.
                    </Text>
                    {aiTitleSuggestions.length > 0 ? (
                      <View style={styles.aiTitlePickBlock}>
                        <Text style={styles.wizardFieldHint}>✨ AI 추천 — 탭하면 이름에 넣어요</Text>
                        <ScrollView
                          horizontal
                          nestedScrollEnabled
                          showsHorizontalScrollIndicator={false}
                          keyboardShouldPersistTaps="handled"
                          contentContainerStyle={styles.aiTitlePickRow}>
                          {aiTitleSuggestions.map((hint) => (
                            <Pressable
                              key={hint}
                              onPress={() => setTitle(hint)}
                              style={({ pressed }) => [
                                styles.aiTitleChip,
                                styles.aiTitlePickChip,
                                pressed && styles.aiTitleChipPressed,
                              ]}
                              accessibilityRole="button">
                              <Text style={styles.aiTitleChipText} numberOfLines={2}>
                                「{hint}」
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    ) : null}
                    {isPublicMeeting ? (
                      <>
                        <Text style={[styles.wizardFieldLabel, { marginTop: 16 }]}>참가 인원</Text>
                        <GlassDualCapacityWheel
                          minValue={minParticipants}
                          maxValue={maxParticipants}
                          onMinChange={onMinParticipantsChange}
                          onMaxChange={onMaxParticipantsChange}
                          disabled={busy}
                        />
                      </>
                    ) : (
                      <>
                        <Text style={[styles.wizardFieldLabel, { marginTop: 16 }]}>참석 인원</Text>
                        <GlassSingleCapacityWheel
                          value={minParticipants}
                          onChange={onPrivateAttendeesChange}
                          disabled={busy}
                        />
                      </>
                    )}
                  </VoteCandidateCard>
                  {currentStep === 3 ? (
                    <Pressable
                      onPress={onStep3BasicNext}
                      style={({ pressed }) => [styles.wizardPrimaryBtn, pressed && styles.addCandidateBtnPressed]}
                      accessibilityRole="button">
                      <View pointerEvents="none" style={styles.wizardPrimaryBtnBg}>
                        <LinearGradient
                          colors={GinitTheme.colors.ctaGradient}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={StyleSheet.absoluteFillObject}
                        />
                      </View>
                      <Text style={styles.wizardPrimaryBtnLabel}>
                        {needsMovieEarlyPlaces ? '확인 · 장소 선택' : '확인 · 일정 설정'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {currentStep >= 4 ? (
                <>
                  {needsMovieEarlyPlaces ? (
                    <View
                      style={styles.wizardStepShell}
                      onLayout={(e) => captureStepPosition(4, e)}>
                      <Text style={styles.wizardStepBadge}>장소 선택</Text>
                      <Text style={styles.wizardLockedHint}>
                        모임 장소 후보를 검색해 추가하세요. 영화 모임은 주변 멀티플렉스를 먼저 보여 드려요.
                      </Text>
                      <VoteCandidateCard
                        reduceHeavyEffects={reduceHeavyEffectsUI}
                        outerStyle={[styles.wizardGlassCard, styles.earlyPlaceCardClip]}>
                        <View style={styles.earlyPlaceSearchMount}>
                          <EarlyPlaceSearch
                            value={earlyPlaceCandidates}
                            onChange={setEarlyPlaceCandidates}
                            showCinemaPicks
                            disabled={busy}
                            parentScrollRef={mainScrollRef}
                            parentScrollYRef={mainScrollYRef}
                          />
                        </View>
                      </VoteCandidateCard>
                    </View>
                  ) : null}

                  {currentStep >= scheduleStep ? (
                    <View style={styles.wizardStepShell} onLayout={(e) => captureStepPosition(scheduleStep, e)}>
                      <View
                        style={[
                          styles.scheduleStepHeader,
                          needsMovieEarlyPlaces && currentStep < scheduleStep && styles.wizardFormHidden,
                        ]}>
                        <Text style={styles.wizardStepBadge}>일정 설정</Text>
                        <Text style={styles.wizardLockedHint}>
                          {currentStep === scheduleStep
                            ? '말로 입력하거나 카드에서 일시 후보를 다듬어 주세요.'
                            : '확정한 일시 후보예요. 필요하면 이전 단계로 돌아가 수정할 수 있어요.'}
                        </Text>
                      </View>

                      {currentStep === scheduleStep ? (
                        <>
                          <View
                            style={[
                              styles.wizardFormMount,
                              needsMovieEarlyPlaces && currentStep < scheduleStep && styles.wizardFormHidden,
                            ]}
                            onLayout={(e) => {
                              formMountRelYRef.current = e.nativeEvent.layout.y;
                            }}>
                            <VoteCandidatesForm
                              ref={scheduleFormRef}
                              key={`wiz-schedule-${voteHydrateKey}`}
                              seedPlaceQuery={seedQ}
                              seedScheduleDate={seedDate}
                              seedScheduleTime={seedTime}
                              placeThemeLabel={selectedCategory?.label ?? ''}
                              initialPayload={votePayload}
                              bare
                              wizardSegment="schedule"
                              scheduleListOnly={false}
                              placesListOnly={currentStep >= detailStep}
                              onPlacesBlockLayout={onPlacesBlockLayout}
                              parentScrollRef={mainScrollRef}
                              parentScrollYRef={mainScrollYRef}
                            />
                          </View>

                          <Pressable
                            onPress={handleConfirmSchedule}
                            style={({ pressed }) => [styles.wizardPrimaryBtn, pressed && styles.addCandidateBtnPressed]}
                            accessibilityRole="button">
                            <View pointerEvents="none" style={styles.wizardPrimaryBtnBg}>
                              <LinearGradient
                                colors={GinitTheme.colors.ctaGradient}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={StyleSheet.absoluteFillObject}
                              />
                            </View>
                            <Text style={styles.wizardPrimaryBtnLabel}>일정 확정하기</Text>
                          </Pressable>
                        </>
                      ) : currentStep > scheduleStep ? (
                        <View style={styles.wizardFormMount}>
                          <VoteCandidatesForm
                            key={`wiz-schedule-summary-${voteHydrateKey}`}
                            seedPlaceQuery={seedQ}
                            seedScheduleDate={seedDate}
                            seedScheduleTime={seedTime}
                            placeThemeLabel={selectedCategory?.label ?? ''}
                            initialPayload={votePayload}
                            bare
                            wizardSegment="schedule"
                            scheduleListOnly
                            placesListOnly
                          />
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {currentStep >= placesStep ? (
                    <View style={styles.wizardStepShell} onLayout={(e) => captureStepPosition(placesStep, e)}>
                      <View
                        ref={placesStepHeaderAnchorRef}
                        collapsable={false}
                        style={styles.placesStepHeader}>
                        <Text style={styles.wizardStepBadge}>장소 후보</Text>
                        <Text style={styles.wizardLockedHint}>
                          {currentStep >= detailStep
                            ? '확정한 장소 후보예요. 필요하면 카드를 탭해 바꿀 수 있어요.'
                            : '장소 행을 눌러 검색·선택하거나 후보를 추가하세요.'}
                        </Text>
                      </View>

                      <View style={styles.wizardFormMount}>
                        <VoteCandidatesForm
                          ref={placesFormRef}
                          key={`wiz-places-${voteHydrateKey}`}
                          seedPlaceQuery={seedQ}
                          seedScheduleDate={seedDate}
                          seedScheduleTime={seedTime}
                          placeThemeLabel={selectedCategory?.label ?? ''}
                          initialPayload={votePayload}
                          bare
                          wizardSegment="places"
                          scheduleListOnly={true}
                          placesListOnly={currentStep >= detailStep}
                          onPlacesBlockLayout={onPlacesBlockLayout}
                        />
                      </View>

                      {currentStep === placesStep ? (
                        <Pressable
                          onPress={onPlacesStepConfirm}
                          style={({ pressed }) => [styles.wizardPrimaryBtn, pressed && styles.addCandidateBtnPressed]}
                          accessibilityRole="button">
                          <View pointerEvents="none" style={styles.wizardPrimaryBtnBg}>
                            <LinearGradient
                              colors={GinitTheme.colors.ctaGradient}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={StyleSheet.absoluteFillObject}
                            />
                          </View>
                          <Text style={styles.wizardPrimaryBtnLabel}>확인 · 상세 조건</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}

                  {currentStep >= detailStep ? (
                    <View style={styles.wizardStepShell} onLayout={(e) => captureStepPosition(detailStep, e)}>
                      <Text style={[styles.wizardStepBadge, { marginTop: 2 }]}>상세 조건 (선택)</Text>
                      <Text style={styles.wizardLockedHint}>
                        위에서 확정한 일정을 확인한 뒤 등록해 주세요. 소개를 비워 두면 지닛이 맞춤 소개글을
                        자동으로 넣어 드려요.
                      </Text>

                      {isPublicMeeting ? (
                        <>
                          <Text style={[styles.wizardFieldLabel, { marginTop: 12 }]}>공개 모임</Text>
                          <VoteCandidateCard reduceHeavyEffects={reduceHeavyEffectsUI} outerStyle={styles.wizardGlassCard}>
                            <PublicMeetingDetailsCard
                              reduceHeavyEffects={reduceHeavyEffectsUI}
                              value={meetingConfig}
                              onChange={(next) => {
                                animate();
                                setMeetingConfig(next);
                              }}
                            />
                          </VoteCandidateCard>
                        </>
                      ) : null}

                      <VoteCandidateCard
                        reduceHeavyEffects={reduceHeavyEffectsUI}
                        outerStyle={[styles.wizardGlassCard, styles.finalRegistrationGlass]}>
                        
                        <TextInput
                          ref={detailDescriptionInputRef}
                          {...detailDescriptionDeferKb}
                          value={description}
                          onChangeText={setDescription}
                          placeholder={descriptionPlaceholder}
                          placeholderTextColor={INPUT_PLACEHOLDER}
                          style={[styles.finalDescriptionInput, descFocused && styles.finalDescriptionInputFocused]}
                          multiline
                          textAlignVertical="top"
                          editable={!busy}
                          keyboardType="default"
                          inputMode="text"
                        />
                      </VoteCandidateCard>
                    </View>
                  ) : null}
                </>
              ) : null}
              </View>
            </KeyboardAwareScreenScroll>
          </View>

          {needsMovieEarlyPlaces && currentStep === 4 ? (
            <Pressable
              onPress={onEarlyPlacesFloatingConfirm}
              disabled={earlyPlaceCandidates.length === 0 || busy}
              style={({ pressed }) => [
                styles.earlyPlaceFloatingBtn,
                {
                  bottom: (wizardError ? 88 : 28) + insets.bottom,
                },
                (earlyPlaceCandidates.length === 0 || busy) && styles.addCandidateBtnDisabled,
                pressed &&
                  earlyPlaceCandidates.length > 0 &&
                  !busy &&
                  styles.addCandidateBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{
                disabled: earlyPlaceCandidates.length === 0 || busy,
              }}>
              <View pointerEvents="none" style={styles.floatingCtaBg}>
                <LinearGradient
                  colors={GinitTheme.colors.ctaGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
              </View>
              <Text style={styles.wizardPrimaryBtnLabel}>
                {earlyPlaceCandidates.length}개의 장소로 일정 정하기
              </Text>
            </Pressable>
          ) : null}

          {currentStep === detailStep ? (
            <Pressable
              onPress={onFinalRegister}
              disabled={finalDisabled}
              style={({ pressed }) => [
                styles.detailFinalFloatingBtn,
                {
                  bottom: (wizardError ? 88 : 28) + insets.bottom,
                },
                finalDisabled && styles.addCandidateBtnDisabled,
                pressed && !finalDisabled && styles.addCandidateBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: finalDisabled }}>
              <View pointerEvents="none" style={styles.floatingCtaBg}>
                <LinearGradient
                  colors={GinitTheme.colors.ctaGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
              </View>
              {busy ? (
                <View style={styles.detailFinalFloatingInner}>
                  <ActivityIndicator color="#FFFFFF" />
                  <Text style={styles.detailFinalFloatingLabel}>등록 중…</Text>
                </View>
              ) : (
                <Text style={styles.detailFinalFloatingLabel}>지닛 모임 등록 완료</Text>
              )}
            </Pressable>
          ) : null}

          {wizardError ? (
            <Text pointerEvents="none" style={styles.wizardFloatingError}>
              {wizardError}
            </Text>
          ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    backgroundColor: GinitTheme.colors.bg,
  },
  safeArea: {
    flex: 1,
    backgroundColor: GinitTheme.colors.bg,
    paddingHorizontal: GinitTheme.spacing.md,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  snsGateBanner: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(251, 191, 36, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    gap: 8,
  },
  snsGateTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#92400e',
  },
  snsGateBody: {
    fontSize: 13,
    fontWeight: '600',
    color: '#78350f',
    lineHeight: 19,
  },
  snsGateBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: GinitTheme.colors.primary,
  },
  snsGateBtnLabel: {
    fontSize: 13,
    fontWeight: '900',
    color: '#fff',
  },
  backLink: {
    fontSize: 16,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
    minWidth: 56,
  },
  screenTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    letterSpacing: -0.3,
  },
  scrollContent: {
    paddingTop: 6,
    paddingBottom: 28,
  },
  sectionHeader: {
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: GinitTheme.colors.text,
    letterSpacing: -0.35,
  },
  sectionHint: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    lineHeight: 19,
    marginBottom: 10,
  },
  /** 자연어 일정 입력 — 리스트 상단 */
  nlpSection: {
    marginBottom: 6,
  },
  aiQuickInitLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: GinitTheme.colors.textMuted,
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  aiQuickInitBorder: {
    borderRadius: 16,
    padding: 2,
    marginBottom: 8,
  },
  aiQuickInitInner: {
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.surface,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 20,
  },
  aiQuickInitInput: {
    minHeight: 20,
    fontSize: 16,
    fontWeight: '700',
    color: GinitTheme.colors.text,
    lineHeight: 22,
    padding: 0,
    margin: 0,
  },
  aiPreviewRow: {
    marginTop: 2,
    marginBottom: 8,
    gap: 8,
  },
  aiPreviewHint: {
    fontSize: 12,
    fontWeight: '800',
    color: GinitTheme.colors.textMuted,
  },
  aiPreviewScroll: {
    gap: 10,
    paddingBottom: 2,
    paddingRight: 0,
  },
  aiPreviewCard: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: GinitTheme.colors.surface,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    padding: 12,
    ...GinitTheme.shadow.card,
  },
  aiPreviewCardMuted: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.70)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    padding: 12,
  },
  aiPreviewEmpty: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    lineHeight: 18,
  },
  aiPreviewPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    marginBottom: 10,
  },
  aiPreviewPillText: {
    fontSize: 11,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
  },
  aiPreviewTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    letterSpacing: -0.2,
    marginBottom: 8,
  },
  aiPreviewMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    lineHeight: 16,
  },
  aiQuickInitCta: {
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
    ...GinitTheme.shadow.card,
  },
  aiQuickInitCtaBg: {
    ...StyleSheet.absoluteFillObject,
  },
  aiQuickInitCtaLabel: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  aiQuickInitCtaPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  nlpChip: {
    alignSelf: 'flex-start',
    marginTop: 10,
    marginBottom: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 82, 204, 0.38)',
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.55)',
  },
  nlpChipPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  nlpChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.2,
  },
  sectionGap: {
    marginTop: 18,
  },
  /** 글래스 카드: shadow wrapper + clip inner (Android elevation 안전) */
  glassCardWrap: {
    marginBottom: 12,
    borderRadius: 24,
    backgroundColor: GinitTheme.colors.surface,
    shadowColor: GinitTheme.shadow.card.shadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 14,
  },
  glassCardInner: {
    borderRadius: 24,
    padding: 14,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: GinitTheme.colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  /** 장소 후보 카드 전용(컴팩트) — 너무 큰 박스 방지 */
  placeCardOuter: {
    padding: 12,
  },
  deleteIconBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.67)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  cardFieldTitleNoDeleteOffset: {
    paddingRight: 0,
  },
  deleteIconText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  /** 카드 안 제목 (일정 후보 1 등) */
  cardFieldTitle: {
    color: GinitTheme.colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    paddingRight: 40,
  },
  row2: {
    flexDirection: 'row',
    gap: 8,
  },
  /** 음각 필드 래퍼 */
  fieldRecess: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)', // 흰색 반투명 (Line 229)
    borderColor: 'rgba(0, 0, 0, 0.93)', // 아주 연한 테두리 추가
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  placeFieldRecess: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderColor: GinitTheme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  placeSuggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
    paddingRight: 4,
    marginBottom: 10,
  },
  placeSuggestChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  placeSuggestChipPressed: {
    opacity: 0.9,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderColor: 'rgba(134, 211, 183, 0.75)',
  },
  placeSuggestChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: GinitTheme.colors.text,
    maxWidth: 220,
  },
  placeResultsScrollHost: {
    width: '100%',
    marginTop: 4,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    overflow: 'hidden',
  },
  placeResultsScrollView: {
    flex: 1,
  },
  placeResultsScrollContent: {
    paddingBottom: 10,
    paddingHorizontal: 4,
  },
  placeResultsGrid: {
    flexDirection: 'column',
    gap: 10,
  },
  placeResultsStatus: {
    width: '100%',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  placeResultsStatusText: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    textAlign: 'center',
  },
  placeResultCard: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  placeResultCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  placeResultTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    lineHeight: 18,
    marginBottom: 6,
  },
  placeResultAddr: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    lineHeight: 15,
  },
  placePickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  placePickedName: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '800',
    color: GinitTheme.colors.text,
  },
  placePickedRemove: {
    fontSize: 12,
    fontWeight: '900',
    color: GinitTheme.colors.danger,
  },
  fieldRecessHalf: {
    flex: 1,
    minWidth: 0,
  },
  textInputBare: {
    backgroundColor: 'transparent',
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
    padding: 0,
    margin: 0,
  },
  dateTimePressable: {
    gap: 2,
  },
  dateTimeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(0, 0, 0, 0.62)',
  },
  dateTimeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  placeEmoji: {
    fontSize: 16,
    marginBottom: 4,
  },
  placeNameText: {
    fontSize: 14,
    fontWeight: '800',
    color: GinitTheme.colors.text,
    marginBottom: 4,
    paddingRight: 36,
  },
  placeAddrText: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    lineHeight: 17,
  },
  placeHint: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
  },
  placeSearchPressable: {
    minHeight: 24,
    justifyContent: 'center',
  },
  placeDraftText: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  /** + 후보 추가 — 스펙 */
  addCandidateBtn: {
    alignSelf: 'stretch',
    marginBottom: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCandidateBtnLabel: {
    color: GinitTheme.colors.primary,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  addCandidateBtnDisabled: {
    opacity: 0.45,
  },
  addCandidateBtnPressed: {
    opacity: 0.95,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderColor: 'rgba(134, 211, 183, 0.75)',
  },
  wizardScrollPad: {
    paddingBottom: 120,
  },
  wizardStepShell: {
    marginBottom: 12,
    borderRadius: GinitTheme.radius.card,
    padding: 12,
    backgroundColor: GinitTheme.colors.surface,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    ...GinitTheme.shadow.card,
  },
  wizardStepPast: {
    opacity: 0.5,
  },
  wizardStepPastWeb: Platform.select<ViewStyle>({
    web: { filter: 'grayscale(65%)' } as ViewStyle,
    default: {},
  }),
  wizardHeroHint: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    lineHeight: 20,
  },
  catGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  catTile: {
    /** 한 줄에 더 많이 들어가도록 작은 박스 (카테고리 증가 대비) */
    width: '23%',
    flexGrow: 0,
    minWidth: '22%',
    maxWidth: '25%',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  catTileActive: {
    borderColor: 'rgba(134, 211, 183, 0.8)',
    backgroundColor: 'rgba(134, 211, 183, 0.16)',
    shadowColor: 'rgba(134, 211, 183, 0.55)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  catTilePressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  catEmoji: {
    fontSize: 18,
    lineHeight: 22,
    marginBottom: 4,
  },
  catLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
    textAlign: 'center',
    letterSpacing: -0.15,
    lineHeight: 13,
  },
  segmentRow: {
    flexDirection: 'row',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  segmentHalf: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  segmentHalfOnPrivate: {
    backgroundColor: 'rgba(31, 42, 68, 0.10)',
  },
  segmentHalfOnPublic: {
    backgroundColor: 'rgba(134, 211, 183, 0.14)',
  },
  segmentTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: GinitTheme.colors.textSub,
  },
  segmentTitleOn: {
    color: GinitTheme.colors.primary,
  },
  segmentSub: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  wizardMuted: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  warnBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
  },
  warnTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: 'rgba(254, 243, 199, 0.98)',
  },
  warnBody: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(253, 230, 138, 0.85)',
    lineHeight: 18,
  },
  scheduleStepHeader: {
    marginBottom: 8,
  },
  placesStepHeader: {
    marginBottom: 10,
  },
  wizardStepBadge: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.2,
    color: GinitTheme.colors.primary,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  wizardGlassCard: {
    marginBottom: 12,
    borderRadius: 10,
    padding: 5,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  wizardFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
    marginBottom: 8,
  },
  wizardFieldHint: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    marginBottom: 10,
  },
  wizardTextInput: {
    backgroundColor: GinitTheme.glassModal.inputFill,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  wizardTextInputMultiline: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  wizardPrimaryBtn: {
    alignSelf: 'stretch',
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
    shadowColor: GinitTheme.glass.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 8,
  },
  wizardPrimaryBtnBg: {
    ...StyleSheet.absoluteFillObject,
  },
  wizardPrimaryBtnLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  wizardLockedHint: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    marginBottom: 10,
    lineHeight: 20,
  },
  wizardDoneHint: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(147, 197, 253, 0.95)',
    marginTop: 10,
    marginBottom: 4,
  },
  wizardFormMount: {
    marginTop: 4,
    marginBottom: 4,
  },
  /** 장소 단계: 페이지 스크롤과 중첩 스크롤 분리(flex 자식 shrink) */
  earlyPlaceCardClip: {
    minHeight: 0,
    maxWidth: '100%',
  },
  earlyPlaceSearchMount: {
    minHeight: 0,
    flexShrink: 1,
    alignSelf: 'stretch',
    width: '100%',
  },
  wizardFormHidden: {
    height: 0,
    opacity: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    marginTop: 0,
    marginBottom: 0,
  },
  aiTitlePickBlock: {
    marginTop: 10,
  },
  aiTitlePickRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    paddingVertical: 2,
    paddingRight: 4,
  },
  aiTitlePickChip: {
    marginTop: 0,
    maxWidth: 240,
  },
  aiTitleChip: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(134, 211, 183, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(134, 211, 183, 0.55)',
    shadowColor: 'rgba(134, 211, 183, 0.40)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 4,
  },
  aiTitleChipPressed: {
    opacity: 0.88,
  },
  aiTitleChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: GinitTheme.colors.text,
    maxWidth: '100%',
  },
  earlyPlaceFloatingBtn: {
    position: 'absolute',
    left: 18,
    right: 18,
    zIndex: 50,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: GinitTheme.glass.borderLight,
    shadowColor: GinitTheme.glass.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 12,
  },
  finalRegistrationGlass: {
    paddingVertical: 6,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.10)',
  },
  finalDescriptionInput: {
    marginTop: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderRadius: 0,
    borderWidth: 0,
    borderColor: GinitTheme.colors.border,
    paddingHorizontal: 7,
    paddingVertical: 7,
    fontSize: 16,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  finalDescriptionInputFocused: {
    borderColor: 'rgba(134, 211, 183, 0.75)',
    shadowColor: 'rgba(134, 211, 183, 0.55)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 6,
  },
  detailFinalFloatingBtn: {
    position: 'absolute',
    left: 18,
    right: 18,
    zIndex: 100,
    paddingVertical: 18,
    paddingHorizontal: 18,
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
  },
  floatingCtaBg: {
    ...StyleSheet.absoluteFillObject,
  },
  detailFinalFloatingLabel: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.35,
  },
  detailFinalFloatingInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  wizardFloatingError: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 24,
    zIndex: 35,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
  },
});
