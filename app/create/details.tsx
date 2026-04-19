/**
 * 모임 등록 — `/create/details`: `currentStep >= n`으로 이전 단계 카드도 유지(한눈에 수정 가능).
 * 확인 버튼만 해당 단계 `currentStep === n`일 때 표시. 카테고리 변경 시 Step 1로 리셋·하위 카드 제거.
 * 일정 확정(`scheduleStep`) 후 `placesStep`에서 장소 후보 카드를 채운 뒤 상세·등록(`detailStep`)으로 이동.
 * 단계 번호(표시): 영화 …→5(일정)→6(장소)→7(상세). 비영화 …→4(일정)→5(장소)→6(상세).
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
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
} from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateCandidateEditorCard, type DatePickerField } from '@/app/create/DateCandidateEditorCard';
import { EarlyPlaceSearch } from '@/components/create/EarlyPlaceSearch';
import { CAPACITY_UNLIMITED, GlassDualCapacityWheel } from '@/components/create/GlassDualCapacityWheel';
import { GlassSingleCapacityWheel } from '@/components/create/GlassSingleCapacityWheel';
import { IntensityPicker } from '@/components/create/IntensityPicker';
import { MenuPreference } from '@/components/create/MenuPreference';
import { MovieSearch } from '@/components/create/MovieSearch';
import { GinitStyles } from '@/constants/GinitStyles';
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
  generateSuggestedMeetingTitles,
  getFinalDescriptionPlaceholder,
} from '@/src/lib/meeting-title-suggestion';
import { addMeeting } from '@/src/lib/meetings';
import { parseSmartNaturalSchedule, type SmartNlpResult } from '@/src/lib/natural-language-schedule';

/** 스펙: Trust Blue */
const TRUST_BLUE = '#0052CC';
/** 스펙: 화면 전체 배경 (다크 네이비) */
const SCREEN_BG = '#0F172A';
/** 스펙: 플레이스홀더 */
const INPUT_PLACEHOLDER = 'rgba(255, 255, 255, 0.4)';

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
  if (reduceHeavyEffects || Platform.OS === 'web') {
    return <View style={[styles.glassCardBlur, outerStyle]}>{children}</View>;
  }
  return (
    <BlurView
      tint="dark"
      intensity={40}
      style={[styles.glassCardBlur, outerStyle]}
      experimentalBlurMethod="dimezisBlurView">
      {children}
    </BlurView>
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
        : [emptyPlaceRow(seedQ)];
    return { placeCandidates, dateCandidates };
  }
  return {
    placeCandidates: [emptyPlaceRow(seedQ)],
    dateCandidates: [createPointCandidate(newId('date'), seedDate, seedTime)],
  };
}

/** 후보 1이 시드 기본 point 그대로인지 (NLP가 첫 카드를 교체해도 되는지). */
function isInitialState(d: DateCandidate, seedDate: string, seedTime: string): boolean {
  if (d.type !== 'point') return false;
  if (d.startDate.trim() !== seedDate.trim()) return false;
  if ((d.startTime ?? '').trim() !== seedTime.trim()) return false;
  if (d.endDate?.trim() || d.endTime?.trim()) return false;
  if (d.textLabel?.trim()) return false;
  if (d.subType) return false;
  if (d.isDeadlineSet) return false;
  return true;
}

type NlpApplyResult = {
  next: DateCandidate[];
  expandRowId: string | null;
  shouldAutoExpand: boolean;
  didAppend: boolean;
};

function computeNlpApply(prev: DateCandidate[], nlp: SmartNlpResult, seedDate: string, seedTime: string): NlpApplyResult {
  const first = prev[0];
  if (prev.length === 1 && first && isInitialState(first, seedDate, seedTime)) {
    const row: DateCandidate = { ...nlp.candidate, id: first.id };
    return {
      next: [row],
      expandRowId: first.id,
      shouldAutoExpand: nlp.candidate.type !== 'point',
      didAppend: false,
    };
  }
  const nid = newId('date');
  return {
    next: [...prev, { ...nlp.candidate, id: nid }],
    expandRowId: nid,
    shouldAutoExpand: nlp.candidate.type !== 'point',
    didAppend: true,
  };
}

export type VoteCandidatesFormProps = {
  seedPlaceQuery?: string;
  seedScheduleDate: string;
  seedScheduleTime: string;
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
};

export type VoteCandidatesBuildResult =
  | { ok: true; payload: VoteCandidatesPayload }
  | { ok: false; error: string };

export type VoteCandidatesGateResult = { ok: true } | { ok: false; error: string };

export type VoteCandidatesFormHandle = {
  buildPayload: () => VoteCandidatesBuildResult;
  validateScheduleStep: () => VoteCandidatesGateResult;
  validatePlacesStep: () => VoteCandidatesGateResult;
  /** 첫 장소 행에 검색어를 넣고 장소 검색 화면을 열어 자동 검색·포커스 */
  openFirstPlaceSearchWithSuggestedQuery: (suggestedQuery: string) => void;
  /** 장소 검색 대기 행·모달 등 파생 UI 정리 */
  resetPlaceSearchSession: () => void;
  /** 장소 후보가 비어 있으면 등록 가능한 플레이스홀더 1행 삽입(일정 확정 후 장소 단계 생략 시) */
  ensurePlacesForWizardFinalize: () => void;
  /** 일정 확정 시점의 일시·장소를 부모 상태와 동기화하기 위해 스냅샷(장소 없으면 플레이스홀더 포함) */
  captureWizardPayloadAfterSchedule: () => VoteCandidatesBuildResult;
  /** 스냅샷을 폼 내부 상태에 반영 — 리마운트 없이 buildPayload와 일치시킴 */
  applyCapturedPayload: (p: VoteCandidatesPayload) => void;
};

export const VoteCandidatesForm = forwardRef<VoteCandidatesFormHandle, VoteCandidatesFormProps>(function VoteCandidatesForm(
  {
    seedPlaceQuery = '',
    seedScheduleDate,
    seedScheduleTime,
    initialPayload = null,
    embedded = false,
    bare = false,
    wizardSegment = 'both',
    onPlacesBlockLayout,
    headerBeforePlaces,
    scheduleListOnly = false,
    placesListOnly = false,
  },
  ref,
) {
  const router = useRouter();
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

  const placeCandidatesRef = useRef(placeCandidates);
  placeCandidatesRef.current = placeCandidates;
  const dateCandidatesRef = useRef(dateCandidates);
  dateCandidatesRef.current = dateCandidates;
  /** `+ 장소 후보 추가` 직후 열린 검색에서 선택 없이 돌아오면 이 행 ID를 제거합니다. */
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
    if (!nlpParsed) return;
    animate();
    const prev = dateCandidatesRef.current;
    const { next, expandRowId, shouldAutoExpand, didAppend } = computeNlpApply(prev, nlpParsed, seedDate, seedTime);
    setDateCandidates(next);
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
    }
  }, [bare, nlpParsed, seedDate, seedTime]);

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
        const p: PlaceCandidate = {
          id: newId('place'),
          placeName: '장소 미정',
          address: '모임 장소는 일정·장소 조율에서 정할 수 있어요.',
          latitude: 37.5665,
          longitude: 126.978,
        };
        setPlaceCandidates([placeRowFromCandidate(p)]);
      },
      captureWizardPayloadAfterSchedule: (): VoteCandidatesBuildResult => {
        const dates = dateCandidatesRef.current;
        for (let i = 0; i < dates.length; i += 1) {
          const err = validateDateCandidate(dates[i], i);
          if (err) return { ok: false, error: err };
        }
        const filled = placeCandidatesRef.current.filter(isFilled);
        let placeCandidatesOut: PlaceCandidate[];
        if (filled.length === 0) {
          placeCandidatesOut = [
            {
              id: newId('place'),
              placeName: '장소 미정',
              address: '모임 장소는 일정·장소 조율에서 정할 수 있어요.',
              latitude: 37.5665,
              longitude: 126.978,
            },
          ];
        } else {
          placeCandidatesOut = filled.map(
            (r) =>
              stripUndefinedDeep({
                id: r.id,
                placeName: r.placeName.trim(),
                address: r.address.trim(),
                latitude: Number(r.latitude),
                longitude: Number(r.longitude),
              }) as PlaceCandidate,
          );
        }
        const dateCandidatesOut = dates.map((d) => stripUndefinedDeep({ ...d }) as DateCandidate);
        return { ok: true, payload: { placeCandidates: placeCandidatesOut, dateCandidates: dateCandidatesOut } };
      },
      applyCapturedPayload: (p: VoteCandidatesPayload) => {
        const next = buildInitialEditorState(p, seedQ, seedDate, seedTime);
        setPlaceCandidates(next.placeCandidates);
        setDateCandidates(next.dateCandidates);
      },
    }),
    [router, seedQ, seedDate, seedTime],
  );

  const openPlaceSearch = useCallback(
    (row: PlaceRowModel) => {
      const q = row.query.trim() || row.placeName.trim();
      requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          router.push({
            pathname: '/place-search',
            params: {
              initialQuery: q,
              voteRowId: row.id,
            },
          });
        });
      });
    },
    [router],
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
        if (prev.length <= 1) {
          return [emptyPlaceRow()];
        }
        return prev.filter((r) => r.id !== ephemeralId);
      });
      InteractionManager.runAfterInteractions(() => animate());
    }, []),
  );

  const addPlaceCandidate = useCallback(() => {
    const row = emptyPlaceRow();
    pendingEphemeralPlaceRowIdRef.current = row.id;
    setPlaceCandidates((prev) => [...prev, row]);
    requestAnimationFrame(() => {
      InteractionManager.runAfterInteractions(() => {
        router.push({
          pathname: '/place-search',
          params: {
            initialQuery: row.query.trim(),
            voteRowId: row.id,
          },
        });
      });
    });
  }, [router]);

  const removePlaceCandidate = useCallback((id: string) => {
    animate();
    setPlaceCandidates((prev) => {
      if (prev.length <= 1) {
        return [emptyPlaceRow()];
      }
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  const addDateRow = useCallback(() => {
    animate();
    const nid = newId('date');
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
    }
  }, [bare]);

  const removeDateRow = useCallback((id: string) => {
    animate();
    setDateCandidates((prev) => (prev.length <= 1 ? prev : prev.filter((d) => d.id !== id)));
  }, []);

  const updateDateRow = useCallback((id: string, patch: Partial<DateCandidate>) => {
    setDateCandidates((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

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

  const lastPlaceCandidate = placeCandidates[placeCandidates.length - 1];
  const canAddPlaceCandidate =
    lastPlaceCandidate != null &&
    lastPlaceCandidate.latitude != null &&
    lastPlaceCandidate.longitude != null;

  const showSchedule = wizardSegment === 'both' || wizardSegment === 'schedule';
  const showPlaces = wizardSegment === 'both' || wizardSegment === 'places';

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
          <Text style={styles.nlpLabel}>[말로 입력하세요]</Text>
          <VoteCandidateCard reduceHeavyEffects={reduceHeavyEffects} outerStyle={styles.nlpGlassOuter}>
            <View style={styles.nlpGlassInner}>
              <TextInput
                value={nlpScheduleInput}
                onChangeText={setNlpScheduleInput}
                placeholder='예: "내일 저녁 7시", "이번 주말 아무 때나"'
                placeholderTextColor={INPUT_PLACEHOLDER}
                style={styles.nlpTextInput}
                multiline={false}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
                underlineColorAndroid="transparent"
              />
            </View>
          </VoteCandidateCard>
          {nlpParsed ? (
            <Pressable
              onPress={applyNlpSuggestion}
              style={({ pressed }) => [styles.nlpChip, pressed && styles.nlpChipPressed]}
              accessibilityRole="button"
              accessibilityLabel="자연어 일정 후보로 등록">
              <Text style={styles.nlpChipText}>📅 {nlpParsed.summary} 등록하기</Text>
            </Pressable>
          ) : null}
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
      {headerBeforePlaces}
      <View style={[styles.sectionHeader, wizardSegment === 'places' ? undefined : styles.sectionGap]}>
        <Text style={styles.sectionTitle}>장소 후보</Text>
      </View>
      <Text style={styles.sectionHint}>
        {placesListOnly
          ? '확정한 장소 후보예요. 필요하면 카드를 탭해 장소를 다시 고를 수 있어요.'
          : '각 카드에서 장소 검색 화면으로 이동해 후보를 채워 주세요.'}
      </Text>

      {placeCandidates.map((row, placeIndex) => (
        <VoteCandidateCard key={row.id} reduceHeavyEffects={reduceHeavyEffects}>
          <View style={styles.glassCardInner}>
            {placeCandidates.length > 1 && !placesListOnly ? (
              <Pressable
                onPress={() => removePlaceCandidate(row.id)}
                style={styles.deleteIconBtn}
                accessibilityRole="button"
                accessibilityLabel="장소 후보 삭제">
                <Text style={styles.deleteIconText}>✕</Text>
              </Pressable>
            ) : null}
            <Text
              style={[
                styles.cardFieldTitle,
                (placeCandidates.length <= 1 || placesListOnly) && styles.cardFieldTitleNoDeleteOffset,
              ]}>
              장소 후보 {placeIndex + 1}
            </Text>
            {isFilled(row) ? (
              <Pressable onPress={() => openPlaceSearch(row)} accessibilityRole="button" accessibilityLabel="장소 다시 선택">
                <Text style={styles.placeEmoji}>📍</Text>
                <Text style={styles.placeNameText} numberOfLines={2}>
                  {row.placeName}
                </Text>
                <Text style={styles.placeAddrText} numberOfLines={4}>
                  {row.address}
                </Text>
                <Text style={styles.placeHint}>
                  {placesListOnly ? '탭하면 장소를 바꿀 수 있어요.' : '탭하여 장소 선택 화면에서 바꾸기'}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.fieldRecess}>
                <Pressable
                  onPress={() => openPlaceSearch(row)}
                  style={styles.placeSearchPressable}
                  accessibilityRole="button"
                  accessibilityLabel="장소 검색 화면으로 이동">
                  <Text 
                    style={[   styles.placeDraftText,     { color: '#0F172A' }, !row.query.trim() && { color: 'rgba(15, 23, 42, 0.35)' }   ]} numberOfLines={2}>
                    {row.query.trim() || '가게 이름 · 주소 검색 (탭하면 장소 선택 화면)'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </VoteCandidateCard>
      ))}

      {!placesListOnly ? (
        <Pressable
          onPress={addPlaceCandidate}
          disabled={!canAddPlaceCandidate}
          style={({ pressed }) => [
            styles.addCandidateBtn,
            !canAddPlaceCandidate && styles.addCandidateBtnDisabled,
            pressed && canAddPlaceCandidate && styles.addCandidateBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canAddPlaceCandidate }}>
          <Text style={styles.addCandidateBtnLabel}>+ 장소 후보 추가</Text>
        </Pressable>
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
  const { phoneUserId } = useUserSession();
  const voteFormRef = useRef<VoteCandidatesFormHandle>(null);
  const mainScrollRef = useRef<ScrollView>(null);
  /** 메인 스크롤 세로 오프셋 — 영화 검색 패널 열 때 정렬에 사용 */
  const mainScrollYRef = useRef(0);
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
  const [aiTitleSuggestions, setAiTitleSuggestions] = useState<string[]>([]);
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
    if (label) {
      setAiTitleSuggestions(generateSuggestedMeetingTitles(label, new Date(), 5));
    } else {
      setAiTitleSuggestions([]);
    }
  }, [paramCategoryLabel, selectedCategory?.label]);

  /**
   * 레이아웃 변화(LayoutAnimation)와 스크롤을 다른 프레임으로 분리.
   */
  const scrollToStep = useCallback((s: WizardStep) => {
    const y = stepPositions.current[s];
    if (y == null || !mainScrollRef.current) return;
    const targetY = Math.max(0, y - 20);

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
        mainScrollRef.current?.scrollTo({ y: targetY, animated: true });
      }, postFrameMs);
    });
  }, []);

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

  useEffect(() => {
    const target = pendingScrollAfterStepRef.current;
    if (target == null || target !== currentStep) return;
    pendingScrollAfterStepRef.current = null;
    const id = setTimeout(() => {
      scrollToStep(target);
    }, 48);
    return () => clearTimeout(id);
  }, [currentStep, scrollToStep]);

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

  const voteWizardSegment = useMemo(() => {
    // 상세 단계에서도 일정·장소 후보 카드는 함께 보여 주고, 편집 범위는 scheduleListOnly / placesListOnly로 제한.
    if (currentStep >= detailStep) return 'both' as const;
    if (currentStep < scheduleStep) return 'none' as const;
    // 일정 단계: 일정만 편집. 장소 카드는「일정 확정」이후 placesStep에서 표시.
    if (currentStep === scheduleStep) return 'schedule' as const;
    // placesStep: 일정 요약 + 장소 후보
    return 'both' as const;
  }, [currentStep, detailStep, scheduleStep]);

  const headerBeforePlaces = useMemo(
    () =>
      currentStep >= placesStep ? (
        <View style={styles.placesStepHeader}>
          <Text style={styles.wizardStepBadge}>
            {placesStep} · 장소 후보
          </Text>
          <Text style={styles.wizardLockedHint}>
            {currentStep >= detailStep
              ? '확정한 장소 후보예요. 필요하면 카드를 탭해 바꿀 수 있어요.'
              : '장소 행을 눌러 검색·선택하거나 후보를 추가하세요.'}
          </Text>
        </View>
      ) : null,
    [currentStep, detailStep, placesStep],
  );

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
      setWizardError('모임 이름을 입력해 주세요.');
      return;
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
  }, [isPublicMeeting, maxParticipants, minParticipants, title]);

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
    const r = voteFormRef.current?.validateScheduleStep();
    if (!r?.ok) {
      setWizardError(r?.error ?? '일정 후보를 확인해 주세요.');
      return;
    }
    const cap = voteFormRef.current?.captureWizardPayloadAfterSchedule();
    if (!cap || !cap.ok) {
      setWizardError(cap && !cap.ok ? cap.error : '일정·장소 데이터를 저장하지 못했어요.');
      return;
    }
    voteFormRef.current?.applyCapturedPayload(cap.payload);
    setVotePayload(cap.payload);
    setPlaceSearchSeed('');
    voteFormRef.current?.resetPlaceSearchSession();
    pendingScrollAfterStepRef.current = placesStep;
    setCurrentStep(placesStep);
  }, [placesStep]);

  const onPlacesStepConfirm = useCallback(() => {
    setWizardError(null);
    const r = voteFormRef.current?.validatePlacesStep();
    if (!r?.ok) {
      setWizardError(r?.error ?? '장소 후보를 확인해 주세요.');
      return;
    }
    pendingScrollAfterStepRef.current = detailStep;
    setCurrentStep(detailStep);
  }, [detailStep]);

  const handleBack = useCallback(() => {
    const r = voteFormRef.current?.buildPayload();
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
    if (!title.trim()) {
      setWizardError('모임 이름을 입력해 주세요.');
      Alert.alert('입력 확인', '모임 이름을 입력해 주세요.');
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
    const built = voteFormRef.current?.buildPayload();
    if (!built?.ok) {
      setWizardError(built?.error ?? '일시·장소 후보를 확인해 주세요.');
      Alert.alert('입력 확인', built?.error ?? '일시·장소 후보를 확인해 주세요.');
      return;
    }
    if (!phoneUserId?.trim()) {
      Alert.alert('전화번호 필요', '모임을 등록하려면 로그인 화면에서 전화번호로 시작해 주세요.');
      router.replace('/');
      return;
    }

    const vote = built.payload;
    const p0 = vote.placeCandidates[0];
    const primary = primaryScheduleFromDateCandidate(vote.dateCandidates[0]);

    const descTrim = description.trim();
    const descriptionForSave =
      descTrim.length > 0
        ? descTrim
        : generateAiMeetingDescription({
            categoryLabel: clabel,
            meetingTitle: title.trim(),
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
      await addMeeting({
        title: title.trim(),
        location: p0.placeName.trim(),
        placeName: p0.placeName.trim(),
        address: p0.address.trim(),
        latitude: Number.isFinite(lat) ? lat : 0,
        longitude: Number.isFinite(lng) ? lng : 0,
        description: descriptionForSave,
        capacity: cap,
        minParticipants: minP,
        createdBy: phoneUserId.trim(),
        categoryId: cid,
        categoryLabel: clabel,
        isPublic: isPublicMeeting,
        scheduleDate: primary.scheduleDate.trim(),
        scheduleTime: primary.scheduleTime.trim(),
        placeCandidates: vote.placeCandidates,
        dateCandidates: vote.dateCandidates,
        extraData,
      });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      setWizardError(msg);
      Alert.alert('등록 실패', msg);
    } finally {
      setBusy(false);
    }
  }, [
    description,
    isPublicMeeting,
    maxParticipants,
    minParticipants,
    phoneUserId,
    router,
    selectedCategory?.id,
    selectedCategory?.label,
    specialtyKind,
    movieCandidates,
    menuPreferences,
    sportIntensity,
    title,
  ]);

  /** 등록 버튼: 로딩 중만 비활성화. 상세 설명 길이는 눌렀을 때 검증(짧으면 안내). */
  const finalDisabled = busy;

  return (
    <View style={styles.screenRoot}>
      <KeyboardAvoidingView
        style={GinitStyles.flexFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
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

          <ScrollView
            ref={mainScrollRef}
            style={GinitStyles.flexFill}
            scrollEnabled
            nestedScrollEnabled
            overScrollMode="never"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={false}
            scrollEventThrottle={1}
            onScroll={(e) => {
              mainScrollYRef.current = e.nativeEvent.contentOffset.y;
            }}
            decelerationRate="normal"
            contentContainerStyle={[
              styles.scrollContent,
              styles.wizardScrollPad,
              needsMovieEarlyPlaces &&
                currentStep === 4 && { paddingBottom: 110 + insets.bottom },
              currentStep === detailStep && { paddingBottom: 108 + insets.bottom },
            ]}>
            <View collapsable={false}>
              <View
                renderToHardwareTextureAndroid
                style={styles.wizardStepShell}
                onLayout={(e) => captureStepPosition(1, e)}>
                <Text style={styles.wizardStepBadge}>1 · 모임 성격</Text>
                <Text style={styles.wizardHeroHint}>어떤 모임인지 골라 주세요. 언제든 바꿀 수 있어요.</Text>

                {catLoading ? (
                  <View style={styles.centerRow}>
                    <ActivityIndicator color="#93C5FD" />
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
                <VoteCandidateCard reduceHeavyEffects={false} outerStyle={styles.wizardGlassCard}>
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
                    <Text style={styles.wizardPrimaryBtnLabel}>
                      {needsSpecialty ? '확인' : '확인'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {selectedCategory != null && needsSpecialty && specialtyKind && currentStep >= 2 ? (
                <View
                  renderToHardwareTextureAndroid
                  style={styles.wizardStepShell}
                  onLayout={(e) => captureStepPosition(2, e)}>
                  <Text style={[styles.wizardStepBadge, { marginTop: 2 }]}>{specialtyStepBadge(specialtyKind)}</Text>
                  <Text style={styles.wizardLockedHint}>카테고리에 맞춰 선택해 주세요.</Text>
                  <VoteCandidateCard reduceHeavyEffects={false} outerStyle={styles.wizardGlassCard}>
                    {specialtyKind === 'movie' ? (
                      <MovieSearch
                        value={movieCandidates}
                        onChange={setMovieCandidates}
                        disabled={busy}
                        parentScrollRef={mainScrollRef}
                        parentScrollYRef={mainScrollYRef}
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
                <View
                  renderToHardwareTextureAndroid
                  style={styles.wizardStepShell}
                  onLayout={(e) => captureStepPosition(3, e)}>
                  <Text style={styles.wizardStepBadge}>3 · 기본 정보</Text>
                  <VoteCandidateCard reduceHeavyEffects={false} outerStyle={styles.wizardGlassCard}>
                    <Text style={styles.wizardFieldLabel}>모임 이름</Text>
                    <TextInput
                      value={title}
                      onChangeText={setTitle}
                      placeholder={
                        aiTitleSuggestions[0]
                          ? `예: ${aiTitleSuggestions[0]}`
                          : '모임 이름을 입력하세요'
                      }
                      placeholderTextColor={INPUT_PLACEHOLDER}
                      style={styles.wizardTextInput}
                      editable={!busy}
                    />
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
                      renderToHardwareTextureAndroid
                      style={styles.wizardStepShell}
                      onLayout={(e) => captureStepPosition(4, e)}>
                      <Text style={styles.wizardStepBadge}>4 · 장소 선택</Text>
                      <Text style={styles.wizardLockedHint}>
                        모임 장소 후보를 검색해 추가하세요. 영화 모임은 주변 멀티플렉스를 먼저 보여 드려요.
                      </Text>
                      <VoteCandidateCard
                        reduceHeavyEffects={false}
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

                  <View
                    renderToHardwareTextureAndroid
                    style={styles.wizardStepShell}
                    onLayout={(e) => captureStepPosition(scheduleStep, e)}>
                    <View
                      style={[
                        styles.scheduleStepHeader,
                        needsMovieEarlyPlaces &&
                          currentStep < scheduleStep &&
                          styles.wizardFormHidden,
                      ]}>
                      <Text style={styles.wizardStepBadge}>
                        {scheduleStep} · 일정 설정
                      </Text>
                      <Text style={styles.wizardLockedHint}>
                        말로 입력하거나 카드에서 일시 후보를 다듬어 주세요.
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.wizardFormMount,
                        needsMovieEarlyPlaces &&
                          currentStep < scheduleStep &&
                          styles.wizardFormHidden,
                      ]}
                      onLayout={(e) => {
                        formMountRelYRef.current = e.nativeEvent.layout.y;
                      }}>
                      <VoteCandidatesForm
                        ref={voteFormRef}
                        key={`wiz-${voteHydrateKey}`}
                        seedPlaceQuery={seedQ}
                        seedScheduleDate={seedDate}
                        seedScheduleTime={seedTime}
                        initialPayload={votePayload}
                        bare
                        wizardSegment={voteWizardSegment}
                        scheduleListOnly={currentStep >= detailStep}
                        placesListOnly={currentStep >= detailStep}
                        onPlacesBlockLayout={onPlacesBlockLayout}
                        headerBeforePlaces={headerBeforePlaces}
                      />
                    </View>

                    {currentStep === scheduleStep ? (
                      <Pressable
                        onPress={handleConfirmSchedule}
                        style={({ pressed }) => [styles.wizardPrimaryBtn, pressed && styles.addCandidateBtnPressed]}
                        accessibilityRole="button">
                        <Text style={styles.wizardPrimaryBtnLabel}>일정 확정하기</Text>
                      </Pressable>
                    ) : null}
                    {currentStep === placesStep ? (
                      <Pressable
                        onPress={onPlacesStepConfirm}
                        style={({ pressed }) => [styles.wizardPrimaryBtn, pressed && styles.addCandidateBtnPressed]}
                        accessibilityRole="button">
                        <Text style={styles.wizardPrimaryBtnLabel}>확인 · 상세 설명</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  {currentStep >= detailStep ? (
                    <View
                      renderToHardwareTextureAndroid
                      style={styles.wizardStepShell}
                      onLayout={(e) => captureStepPosition(detailStep, e)}>
                      <Text style={[styles.wizardStepBadge, { marginTop: 2 }]}>
                        {detailStep} · 상세 설명 (선택)
                      </Text>
                      <Text style={styles.wizardLockedHint}>
                        위에서 확정한 일정을 확인한 뒤 등록해 주세요. 소개를 비워 두면 지닛이 맞춤 소개글을
                        자동으로 넣어 드려요.
                      </Text>

                      <VoteCandidateCard
                        reduceHeavyEffects={false}
                        outerStyle={[styles.wizardGlassCard, styles.finalRegistrationGlass]}>
                        
                        <TextInput
                          value={description}
                          onChangeText={setDescription}
                          placeholder={descriptionPlaceholder}
                          placeholderTextColor={INPUT_PLACEHOLDER}
                          style={[styles.finalDescriptionInput, descFocused && styles.finalDescriptionInputFocused]}
                          multiline
                          textAlignVertical="top"
                          editable={!busy}
                          onFocus={() => setDescFocused(true)}
                          onBlur={() => setDescFocused(false)}
                        />
                      </VoteCandidateCard>
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          </ScrollView>

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

          {wizardError ? <Text style={styles.wizardFloatingError}>{wizardError}</Text> : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  safeArea: {
    flex: 1,
    backgroundColor: SCREEN_BG,
    paddingHorizontal: 20,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  backLink: {
    fontSize: 16,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.85)',
    minWidth: 56,
  },
  screenTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '900',
    color: 'rgba(255, 255, 255, 0.95)',
    letterSpacing: -0.3,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 40,
  },
  sectionHeader: {
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.35,
  },
  sectionHint: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    lineHeight: 19,
    marginBottom: 14,
  },
  /** 자연어 일정 입력 — 리스트 상단 */
  nlpSection: {
    marginBottom: 6,
  },
  nlpLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    color: 'rgba(255, 255, 255, 0.45)',
    marginBottom: 10,
  },
  /** 카드 루트에 합쳐짐: 다크 글로우 + 거의 투명 글래스 배경 */
  nlpGlassOuter: {
    marginBottom: 10,
    padding: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    borderColor: 'rgba(0, 82, 204, 0.45)',
    borderWidth: 1.5,
    shadowColor: TRUST_BLUE,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.88,
    shadowRadius: 36,
    elevation: 26,
  },
  nlpGlassInner: {
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  nlpTextInput: {
    backgroundColor: 'transparent',
    color: 'rgba(255, 255, 255, 0.96)',
    fontSize: 16,
    fontWeight: '600',
    padding: 0,
    margin: 0,
    minHeight: 22,
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
    marginTop: 26,
  },
  /** 글래스 카드: BlurView 루트 — 스펙 수치 그대로 */
  glassCardBlur: {
    marginBottom: 16,
    borderRadius: 24,
    padding: 20,
    backgroundColor: 'rgb(255, 255, 255)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    overflow: 'hidden',
    shadowColor: TRUST_BLUE,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 15,
  },
  glassCardInner: {
    position: 'relative',
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
    color: 'rgb(0, 0, 0)',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    paddingRight: 40,
  },
  row2: {
    flexDirection: 'row',
    gap: 10,
  },
  /** 음각 필드 래퍼 */
  fieldRecess: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)', // 흰색 반투명 (Line 229)
    borderColor: 'rgba(0, 0, 0, 0.93)', // 아주 연한 테두리 추가
    borderRadius: 12,
    padding: 16,
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
    gap: 4,
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
    fontSize: 20,
    marginBottom: 6,
  },
  placeNameText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#000000',
    marginBottom: 6,
    paddingRight: 36,
  },
  placeAddrText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(0, 0, 0, 0.75)',
    lineHeight: 20,
  },
  placeHint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(0, 0, 0, 0.5)',
  },
  placeSearchPressable: {
    minHeight: 24,
    justifyContent: 'center',
  },
  placeDraftText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  /** + 후보 추가 — 스펙 */
  addCandidateBtn: {
    alignSelf: 'stretch',
    marginBottom: 8,
    backgroundColor: TRUST_BLUE,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCandidateBtnLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  addCandidateBtnDisabled: {
    opacity: 0.5,
  },
  addCandidateBtnPressed: {
    opacity: 0.92,
  },
  wizardScrollPad: {
    paddingBottom: 120,
  },
  wizardStepShell: {
    marginBottom: 20,
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
    color: 'rgba(248, 250, 252, 0.55)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  catTileActive: {
    borderColor: 'rgba(147, 197, 253, 0.75)',
    backgroundColor: 'rgba(0, 82, 204, 0.22)',
    shadowColor: TRUST_BLUE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
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
    color: 'rgba(248, 250, 252, 0.9)',
    textAlign: 'center',
    letterSpacing: -0.15,
    lineHeight: 13,
  },
  segmentRow: {
    flexDirection: 'row',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  segmentHalf: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  segmentHalfOnPrivate: {
    backgroundColor: 'rgba(99, 102, 241, 0.22)',
  },
  segmentHalfOnPublic: {
    backgroundColor: 'rgba(14, 165, 233, 0.2)',
  },
  segmentTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: 'rgba(248, 250, 252, 0.55)',
  },
  segmentTitleOn: {
    color: '#F8FAFC',
  },
  segmentSub: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(248, 250, 252, 0.45)',
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
    color: 'rgba(248, 250, 252, 0.45)',
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
    letterSpacing: 0.8,
    color: 'rgba(248, 250, 252, 0.92)',
  },
  wizardGlassCard: {
    marginBottom: 12,
    borderRadius: 20,
    padding: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  wizardFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(248, 250, 252, 0.75)',
    marginBottom: 8,
  },
  wizardFieldHint: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(248, 250, 252, 0.5)',
    marginBottom: 10,
  },
  wizardTextInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  wizardTextInputMultiline: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  wizardPrimaryBtn: {
    alignSelf: 'stretch',
    marginTop: 12,
    backgroundColor: TRUST_BLUE,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: TRUST_BLUE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  wizardPrimaryBtnLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  wizardLockedHint: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(248, 250, 252, 0.45)',
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
    backgroundColor: 'rgba(0, 82, 204, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(0, 82, 204, 0.5)',
    shadowColor: TRUST_BLUE,
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
    color: 'rgba(248, 250, 252, 0.95)',
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TRUST_BLUE,
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.45)',
    shadowColor: TRUST_BLUE,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 12,
  },
  finalRegistrationGlass: {
    paddingVertical: 6,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.38)',
  },
  finalDescriptionInput: {
    marginTop: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
    minHeight: 160,
    textAlignVertical: 'top',
  },
  finalDescriptionInputFocused: {
    borderColor: TRUST_BLUE,
    shadowColor: TRUST_BLUE,
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TRUST_BLUE,
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.55)',
    shadowColor: TRUST_BLUE,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 22,
    elevation: 14,
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
