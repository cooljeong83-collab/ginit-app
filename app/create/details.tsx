/**
 * 모임 등록 — `/create/details`: `currentStep >= n`으로 이전 단계 카드도 유지(한눈에 수정 가능).
 * 확인 버튼만 해당 단계 `currentStep === n`일 때 표시. 카테고리 변경 시 Step 1로 리셋·하위 카드 제거.
 * 일정 확정(`scheduleStep`) 후 `placesStep`에서 장소 후보 카드를 채운 뒤 상세·등록(`detailStep`)으로 이동.
 * 단계 번호: 4(일정)→5(장소)→6(상세). 영화도 동일(선행 장소 단계 없음 — 장소는 `placesStep` 한 번만).
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
  type RefObject,
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
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type DateTimePickerEvent = Parameters<NonNullable<ComponentProps<typeof DateTimePicker>['onChange']>>[0];

import { ActivityKindPreference } from '@/components/create/ActivityKindPreference';
import {
  AGENT_APPLY_POST_LAYOUT_MS,
  AGENT_APPLY_QUICK_ACK_MS,
  AGENT_APPLY_STEP_GAP_MS,
  AGENT_APPLY_TAP_HOLD_MS,
  AGENT_APPLY_TITLE_MS_PER_CODEPOINT,
  AgentApplyRippleLayer,
} from '@/components/create/agent-apply-ripple';
import { CreateMeetingAgenticAiBootstrap } from '@/components/create/CreateMeetingAgenticAiBootstrap';
import { CreateMeetingAgenticAiProvider } from '@/components/create/CreateMeetingAgenticAiContext';
import { CreateMeetingAgenticAiFab } from '@/components/create/CreateMeetingAgenticAiFab';
import { CreateMeetingWizardAgentBridge } from '@/components/create/CreateMeetingWizardAgentBridge';
import { FocusKnowledgePreference } from '@/components/create/FocusKnowledgePreference';
import { GameKindPreference } from '@/components/create/GameKindPreference';
import {
  CAPACITY_UNLIMITED,
  GlassDualCapacityWheel,
  PARTICIPANT_COUNT_MIN,
} from '@/components/create/GlassDualCapacityWheel';
import { GlassSingleCapacityWheel } from '@/components/create/GlassSingleCapacityWheel';
import { MenuPreference } from '@/components/create/MenuPreference';
import { MovieSearch } from '@/components/create/MovieSearch';
import { PcGameKindPreference } from '@/components/create/PcGameKindPreference';
import { PublicMeetingDetailsCard } from '@/components/create/PublicMeetingDetailsCard';
import { NaverPlaceWebViewModal } from '@/components/NaverPlaceWebViewModal';
import { KeyboardAwareScreenScroll } from '@/components/ui';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { GinitTheme } from '@/constants/ginit-theme';
import { GinitStyles } from '@/constants/GinitStyles';
import { useUserSession } from '@/src/context/UserSessionContext';
import type { WizardSuggestion } from '@/src/lib/agentic-guide/types';
import { layoutAnimateMeetingCreateWizard } from '@/src/lib/android-layout-animation';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import type { SpecialtyKind } from '@/src/lib/category-specialty';
import {
  categoryNeedsSpecialty,
  isActiveLifeMajorCode,
  isPcGameMajorCode,
  isPlayAndVibeMajorCode,
  resolveSpecialtyKindForCategory,
  specialtyStepBadge,
} from '@/src/lib/category-specialty';
import {
  notifyCreateMeetingAgentBubbleDismissFromManualScroll,
  notifyCreateMeetingAgentBubbleShow,
} from '@/src/lib/create-meeting-agent-bubble-dismiss';
import {
  getAgentFabMotionMode,
  getAgentStep1InteractionUnlocked,
  setAgentFabMotionMode,
  setAgentStep1InteractionUnlocked,
  subscribeAgentStep1InteractionUnlocked,
} from '@/src/lib/create-meeting-agent-fab-orchestration';
import {
  coerceDateCandidate,
  createPointCandidate,
  fmtDateYmd,
  maxSelectableScheduleDayStartLocal,
  maxSelectableScheduleYmdLocal,
  primaryScheduleFromDateCandidate,
  validateDateCandidate,
} from '@/src/lib/date-candidate';
import { deferSoftInputUntilUserTapProps } from '@/src/lib/defer-soft-input-until-user-tap';
import { stripUndefinedDeep, toFiniteInt } from '@/src/lib/firestore-utils';
import {
  resolvePlaceSearchRowCoordinates,
  searchPlacesText,
  type PlaceSearchRow,
} from '@/src/lib/google-places-text-search';
import { resolveMeetingCreateRules, type ResolvedMeetingCreateRules } from '@/src/lib/meeting-create-rules';
import { buildMeetingExtraData, type SelectedMovieExtra } from '@/src/lib/meeting-extra-data';
import type { DateCandidate, PlaceCandidate, VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import {
  consumePendingMeetingPlace,
  consumePendingVotePlaceRow,
} from '@/src/lib/meeting-place-bridge';
import {
  assertDateCandidatesNoOverlapWithOtherMeetings,
  DATE_CANDIDATE_OVERLAP_BUFFER_HOURS,
  GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION,
} from '@/src/lib/meeting-schedule-overlap';
import {
  generateAiMeetingDescription,
  generateSuggestedMeetingTitle,
  generateSuggestedMeetingTitles,
  getFinalDescriptionPlaceholder,
  type MeetingTitleSuggestionContext,
} from '@/src/lib/meeting-title-suggestion';
import { fetchTitleWeatherMood } from '@/src/lib/meeting-title-weather';
import { addMeeting, DEFAULT_PUBLIC_MEETING_DETAILS_CONFIG, normalizeProfileGenderToHostSnapshot, type PublicMeetingDetailsConfig } from '@/src/lib/meetings';
import { parseSmartNaturalSchedule, type SmartNlpResult } from '@/src/lib/natural-language-schedule';
import { searchNaverPlaceImageThumbnail } from '@/src/lib/naver-image-search';
import {
  resolveNaverPlaceDetailWebUrlLikeVoteChip,
  sanitizeNaverLocalPlaceLink,
} from '@/src/lib/naver-local-search';
import { ensureNearbySearchBias, invalidateNearbySearchBiasCache } from '@/src/lib/nearby-search-bias';
import { computeNlpApply, dateCandidateDupKey } from '@/src/lib/nlp-schedule-candidates';
import {
  buildDefaultPlaceSearchQuery,
  buildPlaceSuggestedSearchQueries,
} from '@/src/lib/place-query-builder';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import {
  getUserProfile,
  isMeetingServiceComplianceComplete,
  meetingDemographicsIncomplete,
  type UserProfile,
} from '@/src/lib/user-profile';
import { DateCandidateEditorCard, type DatePickerField } from '../../components/create/DateCandidateEditorCard';

/** 레거시 스펙 상수(점진 제거) — 시안 톤 토큰으로 치환 */
const INPUT_PLACEHOLDER = '#94a3b8';
/** Google Places Text Search — 첫 페이지·추가 로드 모두 5건 */
const PLACE_SEARCH_PAGE_SIZE = 5;
const DEFAULT_CALENDAR_PICK_TIME = '19:00';
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;
/** 가로 달력 월 스와이프 전환 중에만 가운데 그리드 opacity를 낮춘 뒤 1로 복귀 */
const CALENDAR_MONTH_SWIPE_TRANSITION_OPACITY = 0.76;

function clampHm(raw: string): string {
  const t = raw.trim();
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (!m) return t;
  const hh = Math.max(0, Math.min(23, Number(m[1])));
  const mm = Math.max(0, Math.min(59, Number(m[2])));
  return `${pad2(hh)}:${pad2(mm)}`;
}


function dateFromYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  const d = new Date(y, mo - 1, da);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
  return d;
}

function monthStartYmd(ymd: string): string {
  const d = dateFromYmd(ymd);
  if (!d) return fmtDate(new Date());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

type SpeechRecognitionErrorEvent = {
  error?: string;
  message?: string;
};

function humanizeSpeechRecognitionError(event: SpeechRecognitionErrorEvent | null | undefined): string {
  const code = String(event?.error ?? '').trim();
  const rawMsg = String(event?.message ?? '').trim();

  const map: Record<string, string> = {
    'not-allowed': '마이크 또는 음성 인식 권한이 없어요. 설정에서 권한을 허용해 주세요.',
    'service-not-allowed':
      '이 기기에서 음성 인식 서비스를 사용할 수 없어요. (음성 인식/구글 음성 서비스 설정을 확인해 주세요)',
    'language-not-supported': '지원되지 않는 언어로 인식을 시작했어요. 한국어(ko-KR)로 다시 시도해 주세요.',
    network: '네트워크 문제로 음성 인식에 실패했어요. 연결 상태를 확인하고 다시 시도해 주세요.',
    'no-speech': '말소리가 감지되지 않았어요. 조금 더 크게 말하거나 다시 시도해 주세요.',
    'audio-capture': '마이크 입력을 가져오지 못했어요. 다른 앱이 마이크를 사용 중인지 확인해 주세요.',
    aborted: '음성 인식이 중단되었어요.',
    interrupted: '다른 오디오(통화/알람 등) 때문에 음성 인식이 중단되었어요.',
    'bad-grammar': '음성 인식 요청 형식이 올바르지 않아요. 앱을 최신으로 업데이트한 뒤 다시 시도해 주세요.',
  };

  if (code && map[code]) return map[code];
  if (rawMsg) {
    if (/[가-힣]/.test(rawMsg)) return rawMsg;
    return `음성 인식에 실패했어요.\n\n원인: ${rawMsg}${code ? `\n코드: ${code}` : ''}`;
  }
  return '음성 인식에 실패했어요. 잠시 후 다시 시도해 주세요.';
}

function VoiceWaveform({ active, color }: { active: boolean; color: string }) {
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

/** 단계 전환 시 카드가 레이아웃 애니메이션으로 펼쳐지도록 설정 */
function animate() {
  layoutAnimateMeetingCreateWizard();
}

/** 스택 전환 중에는 BlurView 대신 정적 View로 GPU 부하를 줄입니다. */
function VoteCandidateCard({
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

function defaultScheduleTimePlus3Hours(): string {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return fmtTime(d);
}

function weekendAnytimeMatches(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /주말\s*아무\s*때나|이번\s*주말\s*아무\s*때나|주말\s*(언제|아무)\s*(든|때나)|주말\s*아무때나/.test(t);
}

const WEEKEND_ANYTIME_PREVIEW_COUNT = 5;

/** 이번·다음 주말의 여러 시각대 풀(미리보기에서 랜덤 샘플링) */
function upcomingWeekendSlotPool(now: Date): { ymd: string; hm: string }[] {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
  const min = new Date(base.getTime() + 3 * 60 * 60 * 1000);

  const day = base.getDay(); // 0 Sun .. 6 Sat
  const daysToSat = (6 - day + 7) % 7;
  const sat0 = new Date(base.getFullYear(), base.getMonth(), base.getDate() + daysToSat, 0, 0, 0, 0);

  const mk = (d: Date, hh: number, mm: number) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);

  const hours = [11, 13, 15, 17, 19, 21];
  const candidates: Date[] = [];
  for (const weekOffset of [0, 7]) {
    const sat = new Date(sat0.getFullYear(), sat0.getMonth(), sat0.getDate() + weekOffset, 0, 0, 0, 0);
    const sun = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1, 0, 0, 0, 0);
    for (const h of hours) {
      candidates.push(mk(sat, h, 0));
      candidates.push(mk(sun, h, 0));
    }
  }

  return candidates
    .filter((d) => d.getTime() >= min.getTime())
    .map((d) => ({ ymd: fmtDateYmd(d), hm: fmtTime(d) }));
}

function pickRandomUniqueSlots(slots: { ymd: string; hm: string }[], count: number): { ymd: string; hm: string }[] {
  const a = slots.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  const out: { ymd: string; hm: string }[] = [];
  const seen = new Set<string>();
  for (const s of a) {
    const k = `${s.ymd}|${s.hm}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= count) break;
  }
  return out;
}

function forcePointCandidate(d: DateCandidate): DateCandidate {
  const startDate = String(d.startDate ?? '').trim() || fmtDate(new Date());
  const startTime = String(d.startTime ?? '').trim() || defaultScheduleTimePlus3Hours();
  return {
    ...d,
    type: 'point',
    startDate,
    startTime,
    endDate: undefined,
    endTime: undefined,
    subType: undefined,
    textLabel: undefined,
    isDeadlineSet: undefined,
  };
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
  }
}

function pickerFieldLabel(field: DatePickerField): string {
  switch (field) {
    case 'startDate':
      return '시작 날짜';
    case 'startTime':
      return '시작 시간';
  }
}

type PlaceRowModel = {
  id: string;
  query: string;
  placeName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  naverPlaceLink?: string;
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
  const link = (p.naverPlaceLink ?? '').trim();
  return {
    id: p.id,
    query: p.placeName,
    placeName: p.placeName,
    address: p.address,
    latitude: p.latitude,
    longitude: p.longitude,
    ...(link ? { naverPlaceLink: link } : {}),
  };
}

function buildInitialEditorState(
  initialPayload: VoteCandidatesPayload | null | undefined,
  seedQ: string,
  seedDate: string,
  seedTime: string,
): { placeCandidates: PlaceRowModel[]; dateCandidates: DateCandidate[] } {
  const todayStr = fmtDateYmd(new Date());
  const sdRaw = seedDate.trim();
  const safeSeedDate = /^\d{4}-\d{2}-\d{2}$/.test(sdRaw) ? (sdRaw < todayStr ? todayStr : sdRaw) : todayStr;

  const hasPayload =
    (initialPayload?.placeCandidates?.length ?? 0) > 0 || (initialPayload?.dateCandidates?.length ?? 0) > 0;
  if (hasPayload && initialPayload) {
    const dateCandidates: DateCandidate[] =
      initialPayload.dateCandidates.length > 0
        ? initialPayload.dateCandidates.map((d) => {
            const c = coerceDateCandidate(d, { startDate: safeSeedDate, startTime: seedTime });
            const raw = d as { id?: string };
            const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : newId('date');
            return forcePointCandidate({ ...c, id });
          })
        : [];
    const placeCandidates =
      initialPayload.placeCandidates.length > 0
        ? initialPayload.placeCandidates.map(placeRowFromCandidate)
        : [];
    return { placeCandidates, dateCandidates };
  }
  return {
    placeCandidates: [],
    dateCandidates: [],
  };
}

// (NLP 적용 결과 타입은 `computeNlpApply` 반환 타입을 사용합니다.)

export type VoteCandidatesFormProps = {
  seedPlaceQuery?: string;
  seedScheduleDate: string;
  seedScheduleTime: string;
  /** 장소 후보 단계: AI 검색어 생성에 쓰는 테마(카테고리 라벨) */
  placeThemeLabel?: string;
  /** `major_code` 기반 특화 — 장소 시드가 라벨 정규식과 어긋나지 않게 전달 */
  placeThemeSpecialtyKind?: SpecialtyKind | null;
  /** `major_code` Eat & Drink 등 — Step2 메뉴 성향이 장소 추천어에 반영되도록 전달 */
  placeMenuPreferenceLabels?: readonly string[] | null;
  /** 장소 시드·추천어에서 Eat & Drink 전용(카테고리명·시각·인원·브런치 제외 규칙) 분기 */
  placeThemeMajorCode?: string | null;
  /** Active & Life — Step2 활동 종류를 장소 추천어·시드 풀에 반영 */
  placeActivityKindLabels?: readonly string[] | null;
  /** Play & Vibe — Step2 게임 종류를 장소 시드에 반영 */
  placeGameKindLabels?: readonly string[] | null;
  /** Focus & Knowledge — Step2 모임 성격 칩을 장소 시드에 반영 */
  placeFocusKnowledgePreferenceLabels?: readonly string[] | null;
  /** 비공개 모임 인원 — 장소 검색어 보강(소수/다인원). 공개 모임에서는 생략 */
  placeMinParticipants?: number;
  placeMaxParticipants?: number;
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
  /** true면 AI 미리보기/주말 미리보기 탭 시 새 행이 아니라 첫 번째 일정 후보만 덮어씀(날짜 제안 모달 등). `+ 일자 후보 등록` 버튼도 숨김 */
  scheduleAiReplacesFirstCandidate?: boolean;
  /**
   * 설정 시 장소「상세 정보」는 내부 WebView 모달 대신 상위에서 연다(모임 상세 장소 제안 등 **Modal 중첩** 방지).
   */
  onNaverPlaceWebOpen?: (url: string, title: string) => void;
};

export type VoteCandidatesBuildResult =
  | { ok: true; payload: VoteCandidatesPayload }
  | { ok: false; error: string };

export type VoteCandidatesGateResult = { ok: true } | { ok: false; error: string };

export type VoteCandidatesFormHandle = {
  buildPayload: () => VoteCandidatesBuildResult;
  validateScheduleStep: () => Promise<VoteCandidatesGateResult>;
  validatePlacesStep: () => VoteCandidatesGateResult;
  /** 일정 스텝 첫 입력(자연어) 포커스 */
  focusScheduleIdeaInput: () => void;
  /** 장소 스텝 첫 입력(검색어) 포커스 */
  focusPlaceQueryInput: () => void;
  /** 첫 장소 행에 검색어를 넣고 장소 검색 화면을 열어 자동 검색·포커스 */
  openFirstPlaceSearchWithSuggestedQuery: (suggestedQuery: string) => void;
  /** 인라인 장소 검색어 주입 후 debounce 검색(에이전트) */
  setPlaceQueryFromAgent: (q: string) => void;
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
  /**
   * FAB 자동 적용: 달력 월 맞춤 → 날짜 셀 강조 →(iOS·웹) 시간 피커 스피너 값을 단계적으로 갱신한 뒤 후보 확정.
   * Android는 네이티브 시간 피커를 프로그램으로 돌릴 수 없어 동일 후보를 강조 후 바로 반영합니다.
   */
  playAgentSchedulePickAnimation: (opts: {
    ymd: string;
    hm: string;
    isAlive: () => boolean;
  }) => Promise<void>;
};

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
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [placeSearchLoadingMore, setPlaceSearchLoadingMore] = useState(false);
  const [placeSearchErr, setPlaceSearchErr] = useState<string | null>(null);
  const [placeSearchNextPageToken, setPlaceSearchNextPageToken] = useState<string | null>(null);
  const placeSearchQueryKeyRef = useRef<string>('');
  /** 가로 스크롤 끝에서 `loadMore`가 연속 호출되는 것 방지 */
  const placeSearchLoadMoreGuardRef = useRef(false);
  const [placeThumbById, setPlaceThumbById] = useState<Record<string, string | null>>({});
  const [placeSelectedById, setPlaceSelectedById] = useState<Record<string, { placeName: string; address: string }>>(
    {},
  );
  const [placeResolvingById, setPlaceResolvingById] = useState<Record<string, boolean>>({});
  const [naverPlaceWebModal, setNaverPlaceWebModal] = useState<{ url: string; title: string } | null>(null);

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
              ...(r.naverPlaceLink?.trim() ? { naverPlaceLink: r.naverPlaceLink.trim() } : {}),
            }) as PlaceCandidate,
        );
        const dateCandidatesOut = dates.map((d) => stripUndefinedDeep({ ...d }) as DateCandidate);
        return { ok: true, payload: { placeCandidates: placeCandidatesOut, dateCandidates: dateCandidatesOut } };
      },
      /** 키보드는 사용자가 입력창을 탭할 때만 뜨도록, 자동 포커스는 하지 않습니다. */
      focusScheduleIdeaInput: () => {},
      focusPlaceQueryInput: () => {},
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
      setPlaceQueryFromAgent: (q: string) => {
        const qt = q.trim();
        if (!qt) return;
        placeQueryUserTouchedRef.current = true;
        setPlaceQuery(qt);
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
              ...(r.naverPlaceLink?.trim() ? { naverPlaceLink: r.naverPlaceLink.trim() } : {}),
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
              ...(r.naverPlaceLink?.trim() ? { naverPlaceLink: r.naverPlaceLink.trim() } : {}),
            }) as PlaceCandidate,
        );
        return { ok: true, payload: { placeCandidates: placeCandidatesOut, dateCandidates: [] } };
      },
      applyCapturedPayload: (p: VoteCandidatesPayload) => {
        const next = buildInitialEditorState(p, seedQ, seedDate, seedTime);
        setPlaceCandidates(next.placeCandidates);
        setDateCandidates(next.dateCandidates);
      },
      playAgentSchedulePickAnimation,
    }),
    [router, seedQ, seedDate, seedTime, sessionUserId, playAgentSchedulePickAnimation],
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
                  ...(sel.naverPlaceLink?.trim() ? { naverPlaceLink: sel.naverPlaceLink.trim() } : {}),
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

  useEffect(() => {
    if (!showPlaces || placesListOnly) return undefined;
    const qTrim = placeQuery.trim();
    if (qTrim.length === 0) {
      setPlaceSearchRows([]);
      setPlaceSearchErr(null);
      setPlaceSearchLoading(false);
      setPlaceSearchLoadingMore(false);
      setPlaceSearchNextPageToken(null);
      placeSearchQueryKeyRef.current = '';
      setPlaceThumbById({});
      return undefined;
    }
    let alive = true;
    setPlaceSearchLoading(true);
    setPlaceSearchErr(null);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const { bias, coords } = await ensureNearbySearchBias();
          if (!alive) return;
          const { places: list, nextPageToken } = await searchPlacesText(qTrim, {
            locationBias: bias,
            userCoords: coords,
            maxResultCount: PLACE_SEARCH_PAGE_SIZE,
          });
          if (!alive) return;
          setPlaceSearchRows(list);
          setPlaceSearchNextPageToken(nextPageToken?.trim() ? nextPageToken.trim() : null);
          placeSearchQueryKeyRef.current = qTrim;
          setPlaceThumbById({});
        } catch (e) {
          if (!alive) return;
          setPlaceSearchRows([]);
          setPlaceSearchErr(e instanceof Error ? e.message : '검색에 실패했습니다.');
          setPlaceSearchNextPageToken(null);
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

  useEffect(() => {
    if (!showPlaces || placesListOnly) return undefined;
    if (placeSearchLoading) return undefined;
    if (placeSearchErr) return undefined;
    if (placeSearchRows.length === 0) return undefined;

    const visible = placeSearchRows.slice(0, Math.min(30, placeSearchRows.length));
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

  const loadMorePlaceSearchRows = useCallback(() => {
    if (!showPlaces || placesListOnly) return;
    if (placeSearchLoading || placeSearchLoadingMore) return;
    if (placeSearchErr) return;
    const pageToken = placeSearchNextPageToken;
    if (pageToken == null) return;
    const qTrim = placeQuery.trim();
    if (!qTrim) return;
    if (placeSearchQueryKeyRef.current !== qTrim) return;
    if (placeSearchLoadMoreGuardRef.current) return;
    placeSearchLoadMoreGuardRef.current = true;

    setPlaceSearchLoadingMore(true);
    void (async () => {
      try {
        const { bias, coords } = await ensureNearbySearchBias();
        const { places: list, nextPageToken } = await searchPlacesText(qTrim, {
          locationBias: bias,
          userCoords: coords,
          pageToken,
          maxResultCount: PLACE_SEARCH_PAGE_SIZE,
        });
        setPlaceSearchRows((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          const add = list.filter((r) => !seen.has(r.id));
          return add.length > 0 ? [...prev, ...add] : prev;
        });
        setPlaceSearchNextPageToken(nextPageToken?.trim() ? nextPageToken.trim() : null);
      } catch (e) {
        setPlaceSearchErr(e instanceof Error ? e.message : '검색에 실패했습니다.');
        setPlaceSearchNextPageToken(null);
      } finally {
        placeSearchLoadMoreGuardRef.current = false;
        setPlaceSearchLoadingMore(false);
      }
    })();
  }, [
    placeQuery,
    placeSearchErr,
    placeSearchLoading,
    placeSearchLoadingMore,
    placeSearchNextPageToken,
    placesListOnly,
    showPlaces,
  ]);

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
          : '검색어를 입력하면 AI가 추천하는 장소 후보를 추천해 드려요.'}
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
                    setPlaceQuery(q);
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
            const visible = placeSearchRows;
            return (
              <View style={[styles.placeResultsScrollHost, styles.placeResultsCarouselHost]}>
                <ScrollView
                  horizontal={!centerEmpty}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsHorizontalScrollIndicator={false}
                  showsVerticalScrollIndicator={false}
                  scrollEventThrottle={16}
                  onScroll={(e) => {
                    if (centerEmpty) return;
                    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                    if (contentSize.width <= 0) return;
                    const nearEnd = contentOffset.x + layoutMeasurement.width >= contentSize.width - 120;
                    if (nearEnd) loadMorePlaceSearchRows();
                  }}
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
                    visible.map((item) => {
                      const title = item.title;
                      const addr = (item.roadAddress || item.address || '').trim() || item.category;
                      const selected = Boolean(placeSelectedById[item.id]);
                      const resolving = Boolean(placeResolvingById[item.id]);
                      const thumb = placeThumbById[item.id] ?? null;
                      /** 모임 상세 장소투표「상세 정보」와 동일: 한 줄 주소 + 제목으로 통합검색 URL */
                      const detailUrl = resolveNaverPlaceDetailWebUrlLikeVoteChip({
                        naverPlaceLink: item.link,
                        title: item.title,
                        addressLine: typeof addr === 'string' && addr.trim() ? addr.trim() : undefined,
                      });
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
                                      (r) => !(r.placeName === title.trim() && r.address === addr.trim()),
                                    );
                                  }
                                  return prev.filter(
                                    (r) => !(r.placeName === picked.placeName && r.address === picked.address),
                                  );
                                });
                                return;
                              }

                              setPlaceResolvingById((prev) => ({ ...prev, [item.id]: true }));
                              void (async () => {
                                try {
                                  const resolved = await resolvePlaceSearchRowCoordinates(item);
                                  const address = resolved.roadAddress?.trim() || resolved.address?.trim() || addr;
                                  if (resolved.latitude == null || resolved.longitude == null) throw new Error('좌표 없음');
                                  const placeName = resolved.title.trim() || title.trim();
                                  const linkFromApi =
                                    sanitizeNaverLocalPlaceLink(resolved.link) ?? sanitizeNaverLocalPlaceLink(item.link);
                                  const p: PlaceCandidate = {
                                    id: newId('place'),
                                    placeName,
                                    address,
                                    latitude: resolved.latitude,
                                    longitude: resolved.longitude,
                                    ...(linkFromApi ? { naverPlaceLink: linkFromApi } : {}),
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
                              <Text style={styles.placeResultAddr} numberOfLines={2}>
                                {addr}
                              </Text>
                            </View>
                          </Pressable>
                          {detailUrl ? (
                            <Pressable
                              onPress={() => {
                                const t = title.trim() || '장소 상세';
                                if (onNaverPlaceWebOpen) {
                                  onNaverPlaceWebOpen(detailUrl, t);
                                } else {
                                  setNaverPlaceWebModal({ url: detailUrl, title: t });
                                }
                              }}
                              style={({ pressed }) => [styles.placeResultDetailBtn, pressed && { opacity: 0.88 }]}
                              accessibilityRole="button"
                              accessibilityLabel="상세 정보">
                              <Text style={styles.placeResultDetailBtnText}>상세 정보</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      );
                    }).concat(
                      placeSearchLoadingMore
                        ? [
                            <View key="place-loading-more" style={styles.placeResultsLoadingMore}>
                              <ActivityIndicator color={GinitTheme.colors.primary} />
                            </View>,
                          ]
                        : [],
                    )
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

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

type AgentWizardApplyCue =
  | { kind: 'category'; id: string }
  | { kind: 'public'; side: 'public' | 'private' }
  | { kind: 'confirm1' }
  | { kind: 'menu'; label: string }
  | { kind: 'confirm2' }
  | { kind: 'confirmSchedule' };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** FAB 자동 적용 시 모임 이름 필드에 한 글자씩 채워 넣는 연출(이모지 등은 코드포인트 단위). */
async function typewriterAutoMeetingTitle(opts: {
  fullTitle: string;
  setTitle: (next: string) => void;
  isAlive: () => boolean;
  msPerCodePoint: number;
}): Promise<void> {
  const full = opts.fullTitle.trim();
  if (!full) {
    if (opts.isAlive()) opts.setTitle('');
    return;
  }
  const chars = [...full];
  if (!opts.isAlive()) return;
  opts.setTitle('');
  for (let i = 0; i < chars.length; i += 1) {
    if (!opts.isAlive()) return;
    opts.setTitle(chars.slice(0, i + 1).join(''));
    await sleep(opts.msPerCodePoint);
  }
}

/** 자동 위저드 — 참여 이력 평균 인원을 `meeting_create` 정책·공개 여부에 맞게 보정 */
function clampAutoWizardParticipants(
  isPublic: boolean,
  avgMin: number,
  avgMax: number,
  rules: ResolvedMeetingCreateRules,
): { min: number; max: number } {
  const capMax = rules.capacityMax;
  const minFloor = Math.max(PARTICIPANT_COUNT_MIN, rules.minParticipantsFloor);
  let nMin = Math.round(avgMin);
  let nMax = Math.round(avgMax);
  if (!isPublic) {
    const mid = Math.round((nMin + nMax) / 2);
    const n = Math.min(capMax, Math.max(minFloor, mid));
    return { min: n, max: n };
  }
  nMin = Math.min(capMax, Math.max(minFloor, nMin));
  nMax = Math.min(capMax, Math.max(nMin, nMax));
  return { min: nMin, max: nMax };
}

function waitAgentStep1FabUnlocked(): Promise<void> {
  if (getAgentStep1InteractionUnlocked()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const unsub = subscribeAgentStep1InteractionUnlocked(() => {
      if (getAgentStep1InteractionUnlocked()) {
        unsub();
        clearTimeout(tmax);
        resolve();
      }
    });
    const tmax = setTimeout(() => {
      unsub();
      resolve();
    }, 14000);
  });
}

export default function CreateDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
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
        if (!cancelled) setSnsDemographicsBlocked(meetingDemographicsIncomplete(p, uid));
      });
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  useEffect(() => {
    return () => {
      invalidateNearbySearchBiasCache();
    };
  }, []);

  // Android에서 BlurView(특히 experimental blur)가 children 업데이트를 늦게 반영하는 케이스가 있어
  // 즉시 피드백이 중요한 "선택 UI"는 정적 View 렌더링을 우선합니다.
  const reduceHeavyEffectsUI = Platform.OS === 'android';
  const scheduleFormRef = useRef<VoteCandidatesFormHandle>(null);
  const placesFormRef = useRef<VoteCandidatesFormHandle>(null);
  /** `applyWizardSuggestion`가 `handleConfirmSchedule`보다 위에 있어 ref로 최신 콜백을 참조 */
  const handleConfirmScheduleRef = useRef<() => Promise<void>>(async () => {});
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
  /** `applyWizardSuggestion` 비동기 런 id — 새 자동 적용 시 이전 타이핑 연출 중단 */
  const agentWizardApplyRunIdRef = useRef(0);
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
  /** 프로그램 스크롤 중 — `onWizardStepShellLayout`이 FAB 앵커를 중간 프레임에 갱신하지 않도록 */
  const programmaticScrollPendingRef = useRef(false);
  /** 프로그램 스크롤 종료 후 FAB measure 백업(모멘텀 미발화 대비) */
  const scrollSettleMeasureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 사용자 스크롤 중 말풍선 dismiss 알림 스로틀(ms) */
  const scrollDismissLastNotifyMsRef = useRef(0);
  const scheduleAgentFabMeasureRef = useRef<() => void>(() => {});
  const armAgentFabScrollSettleMeasureRef = useRef<() => void>(() => {});
  /** 세로 스크롤 목표 오프셋으로 FAB 앵커 창 좌표를 예측한 뒤 `runScroll` 실행 */
  const predictAgentFabWindowRectBeforeVerticalScrollRef = useRef(
    (_anchorStep: WizardStep, _targetScrollY: number, runScroll: () => void) => {
      runScroll();
    },
  );
  /** 에이전트 FAB — `measureInWindow`로 현재 단계 `wizardStepShell` 우상단에 맞춤 */
  const agentStepShellRefs = useRef<Partial<Record<WizardStep, View | null>>>({});
  const [agentFabWindowRect, setAgentFabWindowRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const currentStepRef = useRef<WizardStep>(1);
  const agentFabMeasureRafRef = useRef<number | null>(null);

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
  const meetingCreateRules = useMemo(
    () => resolveMeetingCreateRules(categories.find((c) => c.id === selectedCategoryId)?.majorCode ?? null),
    [categories, selectedCategoryId],
  );
  const [isPublicMeeting, setIsPublicMeeting] = useState(pickParam(isPublicParam) !== '0');
  const isPublicMeetingRef = useRef(isPublicMeeting);

  const [meetingConfig, setMeetingConfig] = useState<PublicMeetingDetailsConfig>(
    () => DEFAULT_PUBLIC_MEETING_DETAILS_CONFIG,
  );

  const [title, setTitle] = useState('');
  const [minParticipants, setMinParticipants] = useState(PARTICIPANT_COUNT_MIN);
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
    layoutAnimateMeetingCreateWizard();
    if (prev === true && isPublicMeeting === false) {
      const min = minParticipantsRef.current;
      const max = maxParticipantsRef.current;
      const capMax = meetingCreateRules.capacityMax;
      const n =
        max === CAPACITY_UNLIMITED || max > capMax
          ? Math.min(capMax, Math.max(PARTICIPANT_COUNT_MIN, min))
          : Math.min(capMax, Math.max(PARTICIPANT_COUNT_MIN, max));
      setMinParticipants(n);
      setMaxParticipants(n);
    }
  }, [isPublicMeeting, meetingCreateRules.capacityMax]);

  useEffect(() => {
    if (!isPublicMeeting && (minParticipants !== maxParticipants || maxParticipants === CAPACITY_UNLIMITED)) {
      const min = minParticipants;
      const max = maxParticipants;
      const capMax = meetingCreateRules.capacityMax;
      const n =
        max === CAPACITY_UNLIMITED || max > capMax
          ? Math.min(capMax, Math.max(PARTICIPANT_COUNT_MIN, min))
          : Math.min(capMax, Math.max(PARTICIPANT_COUNT_MIN, max));
      setMinParticipants(n);
      setMaxParticipants(n);
    }
  }, [isPublicMeeting, maxParticipants, minParticipants, meetingCreateRules.capacityMax]);

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

  const [voiceTitleRecognizing, setVoiceTitleRecognizing] = useState(false);
  const [voiceDescriptionRecognizing, setVoiceDescriptionRecognizing] = useState(false);
  /** 제목·상세 소개 음성 입력이 같은 모듈 리스너를 쓰므로 결과 라우팅용 */
  const voiceCreateTargetRef = useRef<'title' | 'description' | null>(null);

  useSpeechRecognitionEvent('start', () => {
    const k = voiceCreateTargetRef.current;
    if (k === 'title') setVoiceTitleRecognizing(true);
    if (k === 'description') setVoiceDescriptionRecognizing(true);
  });
  useSpeechRecognitionEvent('end', () => {
    const k = voiceCreateTargetRef.current;
    if (!k) return;
    setVoiceTitleRecognizing(false);
    setVoiceDescriptionRecognizing(false);
    voiceCreateTargetRef.current = null;
  });
  useSpeechRecognitionEvent('error', (event) => {
    const k = voiceCreateTargetRef.current;
    if (!k) return;
    setVoiceTitleRecognizing(false);
    setVoiceDescriptionRecognizing(false);
    voiceCreateTargetRef.current = null;
    Alert.alert('음성 입력 오류', humanizeSpeechRecognitionError(event));
  });
  useSpeechRecognitionEvent('result', (event) => {
    const t = String(event?.results?.[0]?.transcript ?? '').trim();
    if (!t) return;
    const k = voiceCreateTargetRef.current;
    if (!k) return;
    if (k === 'title') setTitle(t);
    if (k === 'description') setDescription(t);
    if (event?.isFinal) {
      setVoiceTitleRecognizing(false);
      setVoiceDescriptionRecognizing(false);
      voiceCreateTargetRef.current = null;
      ExpoSpeechRecognitionModule.stop();
    }
  });

  const onPressVoiceInputTitle = useCallback(async () => {
    if (voiceTitleRecognizing || voiceDescriptionRecognizing) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '음성 입력을 사용하려면 마이크/음성 인식 권한이 필요합니다.');
      return;
    }
    voiceCreateTargetRef.current = 'title';
    ExpoSpeechRecognitionModule.start({
      lang: 'ko-KR',
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
    });
  }, [voiceDescriptionRecognizing, voiceTitleRecognizing]);

  const onPressVoiceInputDescription = useCallback(async () => {
    if (voiceTitleRecognizing || voiceDescriptionRecognizing) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '음성 입력을 사용하려면 마이크/음성 인식 권한이 필요합니다.');
      return;
    }
    voiceCreateTargetRef.current = 'description';
    ExpoSpeechRecognitionModule.start({
      lang: 'ko-KR',
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
    });
  }, [voiceDescriptionRecognizing, voiceTitleRecognizing]);

  const [aiTitleSuggestions, setAiTitleSuggestions] = useState<string[]>([]);
  const [titleRegion, setTitleRegion] = useState<string | null>(null);
  const [titleWeatherMood, setTitleWeatherMood] = useState<string | null>(null);
  const titleSuggestionsGenRef = useRef(0);
  const [votePayload, setVotePayload] = useState<VoteCandidatesPayload | null>(null);
  const [voteHydrateKey, setVoteHydrateKey] = useState(0);
  const [movieCandidates, setMovieCandidates] = useState<SelectedMovieExtra[]>([]);
  const [menuPreferences, setMenuPreferences] = useState<string[]>([]);
  const [activityKinds, setActivityKinds] = useState<string[]>([]);
  const [gameKinds, setGameKinds] = useState<string[]>([]);
  const [focusKnowledgePreferences, setFocusKnowledgePreferences] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [agentWizardApplyCue, setAgentWizardApplyCue] = useState<AgentWizardApplyCue | null>(null);
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  currentStepRef.current = currentStep;
  isPublicMeetingRef.current = isPublicMeeting;

  /** 1단계만 화면 하단 FAB — 2단계 이상은 자동·수동 동일하게 카드 우상단(`cardTopRight`) 도킹 */
  const [aiFabScreenBottomLayout, setAiFabScreenBottomLayout] = useState(true);
  const recomputeAiFabScreenLayout = useCallback(() => {
    setAiFabScreenBottomLayout(currentStepRef.current === 1);
  }, []);

  useEffect(() => {
    recomputeAiFabScreenLayout();
  }, [currentStep, recomputeAiFabScreenLayout]);

  useEffect(() => {
    setAgentWizardApplyCue(null);
    if (currentStep !== 1) {
      setAgentStep1InteractionUnlocked(false);
    }
  }, [currentStep]);

  const prevWizardStepForFabScrollRef = useRef(currentStep);
  if (currentStep !== prevWizardStepForFabScrollRef.current) {
    if (currentStep > 1) {
      programmaticScrollPendingRef.current = true;
      if (scrollSettleMeasureTimerRef.current != null) {
        clearTimeout(scrollSettleMeasureTimerRef.current);
        scrollSettleMeasureTimerRef.current = null;
      }
    }
    if (currentStep === 1) {
      programmaticScrollPendingRef.current = false;
    }
    prevWizardStepForFabScrollRef.current = currentStep;
  }

  useEffect(() => {
    if (!wizardError) return undefined;
    const t = setTimeout(() => setWizardError(null), 2000);
    return () => clearTimeout(t);
  }, [wizardError]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );

  const specialtyKind = useMemo(() => resolveSpecialtyKindForCategory(selectedCategory), [selectedCategory]);
  const activeLifeMajor = useMemo(
    () => isActiveLifeMajorCode(selectedCategory?.majorCode),
    [selectedCategory?.majorCode],
  );
  const playAndVibeMajor = useMemo(
    () => isPlayAndVibeMajorCode(selectedCategory?.majorCode),
    [selectedCategory?.majorCode],
  );
  const pcGameMajor = useMemo(
    () => isPcGameMajorCode(selectedCategory?.majorCode),
    [selectedCategory?.majorCode],
  );
  /** Eat & Drink 대분류일 때만 Step2 메뉴 성향을 네이버 장소 시드에 넘김 */
  const placeMenuPreferenceLabelsForPlaceQuery = useMemo(() => {
    const mc = (selectedCategory?.majorCode ?? '').trim().toLowerCase();
    if (mc !== 'eat & drink') return undefined;
    const prefs = menuPreferences.map((x) => x.trim()).filter(Boolean);
    return prefs.length ? prefs : undefined;
  }, [selectedCategory?.majorCode, menuPreferences]);
  /** Active & Life일 때만 Step2 활동 종류를 네이버 장소 시드에 넘김 */
  const placeActivityKindLabelsForPlaceQuery = useMemo(() => {
    if (!activeLifeMajor) return undefined;
    const prefs = activityKinds.map((x) => x.trim()).filter(Boolean);
    return prefs.length ? prefs : undefined;
  }, [activeLifeMajor, activityKinds]);
  /** Play & Vibe일 때만 Step2 게임 종류를 네이버 장소 시드에 넘김 */
  const placeGameKindLabelsForPlaceQuery = useMemo(() => {
    if (!playAndVibeMajor) return undefined;
    const prefs = gameKinds.map((x) => x.trim()).filter(Boolean);
    return prefs.length ? prefs : undefined;
  }, [playAndVibeMajor, gameKinds]);
  const placeFocusKnowledgePreferenceLabelsForPlaceQuery = useMemo(() => {
    if (specialtyKind !== 'knowledge') return undefined;
    const prefs = focusKnowledgePreferences.map((x) => x.trim()).filter(Boolean);
    return prefs.length ? prefs : undefined;
  }, [specialtyKind, focusKnowledgePreferences]);
  const descriptionPlaceholder = useMemo(
    () =>
      getFinalDescriptionPlaceholder({
        categoryLabel: (selectedCategory?.label ?? paramCategoryLabel).trim(),
        specialtyKind,
      }),
    [paramCategoryLabel, selectedCategory?.label, specialtyKind],
  );
  const needsSpecialty = categoryNeedsSpecialty(selectedCategory);
  const scheduleStep: WizardStep = 4;
  const placesStep: WizardStep = 5;
  const detailStep: WizardStep = 6;

  const resetWizardState = useCallback(() => {
    setTitle('');
    setMinParticipants(PARTICIPANT_COUNT_MIN);
    setMaxParticipants(4);
    setDescription('');
    setMovieCandidates([]);
    setMenuPreferences([]);
    setActivityKinds([]);
    setGameKinds([]);
    setFocusKnowledgePreferences([]);
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
              layoutAnimateMeetingCreateWizard();
              suppressStepLayoutAnimateFromCategoryRef.current = true;
              resetWizardState();
              setSelectedCategoryId(id);
              setCurrentStep(1);
              requestAnimationFrame(() => {
                const scroller = mainScrollRef.current as any;
                if (typeof scroller?.scrollToPosition === 'function') {
                  scroller.scrollToPosition(0, 0, true);
                  return;
                }
                scroller?.scrollTo?.({ y: 0, animated: true });
              });
            },
          },
        ]);
        return;
      }
      // Step 1에서는 선택 즉시 UI가 바뀌도록 애니메이션으로 피드백을 강화합니다.
      layoutAnimateMeetingCreateWizard();
      setSelectedCategoryId(id);
    },
    [currentStep, resetWizardState, selectedCategoryId],
  );

  const screenTitle = useMemo(
    () => (selectedCategory?.label ? `${selectedCategory.label}  모임 생성` : '모임 생성'),
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
          return null;
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
    }, []),
  );

  const titleSuggestionCtx = useMemo(
    (): MeetingTitleSuggestionContext => ({
      regionLabel: titleRegion,
      weatherMood: titleWeatherMood,
      majorCode: selectedCategory?.majorCode ?? null,
      specialtyKind,
      movieTitles:
        specialtyKind === 'movie'
          ? movieCandidates.map((m) => String(m.title ?? '').trim()).filter(Boolean)
          : undefined,
      menuPreferences:
        specialtyKind === 'food' ? menuPreferences.map((x) => x.trim()).filter(Boolean) : undefined,
      activityKinds:
        specialtyKind === 'sports' && activeLifeMajor
          ? activityKinds.map((x) => x.trim()).filter(Boolean)
          : undefined,
      gameKinds:
        specialtyKind === 'sports' && (playAndVibeMajor || pcGameMajor)
          ? gameKinds.map((x) => x.trim()).filter(Boolean)
          : undefined,
      focusKnowledgePreferences:
        specialtyKind === 'knowledge'
          ? focusKnowledgePreferences.map((x) => x.trim()).filter(Boolean)
          : undefined,
    }),
    [
      titleRegion,
      titleWeatherMood,
      selectedCategory?.majorCode,
      specialtyKind,
      movieCandidates,
      menuPreferences,
      activityKinds,
      gameKinds,
      focusKnowledgePreferences,
      activeLifeMajor,
      playAndVibeMajor,
      pcGameMajor,
    ],
  );

  useEffect(() => {
    const label = selectedCategory?.label?.trim() ?? paramCategoryLabel.trim();
    if (!label) {
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
        setTitleRegion(bias?.trim() ?? null);
        setTitleWeatherMood(weather);
      } catch {
        if (!alive || gen !== titleSuggestionsGenRef.current) return;
        setTitleRegion(null);
        setTitleWeatherMood(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [paramCategoryLabel, selectedCategory?.label]);

  useEffect(() => {
    const label = selectedCategory?.label?.trim() ?? paramCategoryLabel.trim();
    if (!label) {
      setAiTitleSuggestions([]);
      return;
    }
    setAiTitleSuggestions(generateSuggestedMeetingTitles(label, new Date(), 5, titleSuggestionCtx));
  }, [paramCategoryLabel, selectedCategory?.label, titleSuggestionCtx]);

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
        predictAgentFabWindowRectBeforeVerticalScrollRef.current(placesStep, nextY, () => {
          armAgentFabScrollSettleMeasureRef.current();
          if (typeof scrollView.scrollTo === 'function') {
            scrollView.scrollTo({ y: nextY, animated: true });
          } else if (typeof scrollView.scrollToPosition === 'function') {
            scrollView.scrollToPosition(0, nextY, true);
          }
        });
      });
    });
  }, []);

  const scrollToStep = useCallback((s: WizardStep) => {
    const y = stepPositions.current[s];
    if (y == null || !mainScrollRef.current) {
      programmaticScrollPendingRef.current = false;
      scheduleAgentFabMeasureRef.current();
      return;
    }
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
    if (scrollSettleMeasureTimerRef.current != null) {
      clearTimeout(scrollSettleMeasureTimerRef.current);
      scrollSettleMeasureTimerRef.current = null;
    }
    programmaticScrollPendingRef.current = true;

    layoutAnimateMeetingCreateWizard();

    scrollToStepRafRef.current = requestAnimationFrame(() => {
      scrollToStepRafRef.current = null;
      /** LayoutAnimation이 한 박자 진행된 뒤 스크롤 — 카드 펼침과 스크롤이 덜 충돌하도록 여유 */
      const postFrameMs = Platform.OS === 'android' ? 220 : 175;
      scrollToStepTimerRef.current = setTimeout(() => {
        scrollToStepTimerRef.current = null;
        InteractionManager.runAfterInteractions(() => {
          const scroller = mainScrollRef.current as any;
          if (!scroller) {
            programmaticScrollPendingRef.current = false;
            scheduleAgentFabMeasureRef.current();
            return;
          }
          predictAgentFabWindowRectBeforeVerticalScrollRef.current(s, targetY, () => {
            armAgentFabScrollSettleMeasureRef.current();
            if (typeof scroller.scrollToPosition === 'function') {
              scroller.scrollToPosition(0, targetY, true);
              return;
            }
            scroller.scrollTo?.({ y: targetY, animated: true });
          });
        });
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
    layoutAnimateMeetingCreateWizard();
  }, [currentStep]);

  useEffect(() => {
    if (busy) return;
    if (currentStep !== scheduleStep) return;
    scrollToStep(scheduleStep);
  }, [busy, currentStep, scheduleStep, scrollToStep]);

  useEffect(() => {
    if (busy) return;
    if (currentStep !== placesStep) return;
    scrollToStep(placesStep);
  }, [busy, currentStep, placesStep, scrollToStep]);

  useEffect(() => {
    const target = pendingScrollAfterStepRef.current;
    if (target == null || target !== currentStep) return;
    pendingScrollAfterStepRef.current = null;
    const id = setTimeout(() => {
      scrollToStep(target);
    }, 96);
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
      t1 = setTimeout(run, Platform.OS === 'android' ? 120 : 72);
      t2 = setTimeout(run, Platform.OS === 'android' ? 320 : 240);
      t3 = setTimeout(run, Platform.OS === 'android' ? 560 : 420);
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
      if (scrollSettleMeasureTimerRef.current != null) {
        clearTimeout(scrollSettleMeasureTimerRef.current);
        scrollSettleMeasureTimerRef.current = null;
      }
    },
    [],
  );

  const captureStepPosition = useCallback((s: WizardStep, e: LayoutChangeEvent) => {
    stepPositions.current[s] = e.nativeEvent.layout.y;
  }, []);

  const measureAgentFabAnchor = useCallback(() => {
    const cs = currentStepRef.current;
    if (cs === 1) {
      setAgentFabWindowRect(null);
      return;
    }
    const node = agentStepShellRefs.current[cs];
    if (!node) {
      setAgentFabWindowRect(null);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      setAgentFabWindowRect({ x, y, width: w, height: h });
    });
  }, []);

  const scheduleAgentFabMeasure = useCallback(() => {
    if (agentFabMeasureRafRef.current != null) {
      cancelAnimationFrame(agentFabMeasureRafRef.current);
    }
    agentFabMeasureRafRef.current = requestAnimationFrame(() => {
      agentFabMeasureRafRef.current = null;
      measureAgentFabAnchor();
    });
  }, [measureAgentFabAnchor]);

  scheduleAgentFabMeasureRef.current = scheduleAgentFabMeasure;

  const armAgentFabScrollSettleMeasure = useCallback(() => {
    programmaticScrollPendingRef.current = true;
    if (scrollSettleMeasureTimerRef.current != null) {
      clearTimeout(scrollSettleMeasureTimerRef.current);
      scrollSettleMeasureTimerRef.current = null;
    }
    const settleMs = Platform.OS === 'android' ? 480 : 420;
    scrollSettleMeasureTimerRef.current = setTimeout(() => {
      scrollSettleMeasureTimerRef.current = null;
      programmaticScrollPendingRef.current = false;
      scheduleAgentFabMeasureRef.current();
    }, settleMs);
  }, []);

  armAgentFabScrollSettleMeasureRef.current = armAgentFabScrollSettleMeasure;

  const onAgentFabMainScrollSettled = useCallback(() => {
    if (scrollSettleMeasureTimerRef.current != null) {
      clearTimeout(scrollSettleMeasureTimerRef.current);
      scrollSettleMeasureTimerRef.current = null;
    }
    programmaticScrollPendingRef.current = false;
    scheduleAgentFabMeasureRef.current();
  }, []);

  const predictAgentFabWindowRectBeforeVerticalScroll = useCallback(
    (anchorStep: WizardStep, targetScrollY: number, runScroll: () => void) => {
      if (anchorStep <= 1) {
        runScroll();
        return;
      }
      const node = agentStepShellRefs.current[anchorStep];
      if (!node) {
        runScroll();
        return;
      }
      node.measureInWindow((x, y, w, h) => {
        const cur = mainScrollYRef.current;
        const dy = targetScrollY - cur;
        setAgentFabWindowRect({ x, y: y - dy, width: w, height: h });
        runScroll();
      });
    },
    [],
  );

  predictAgentFabWindowRectBeforeVerticalScrollRef.current = predictAgentFabWindowRectBeforeVerticalScroll;

  const onWizardStepShellLayout = useCallback(
    (step: WizardStep, e: LayoutChangeEvent) => {
      captureStepPosition(step, e);
      if (currentStepRef.current === step && !programmaticScrollPendingRef.current) {
        scheduleAgentFabMeasure();
      }
    },
    [captureStepPosition, scheduleAgentFabMeasure],
  );

  useEffect(() => {
    if (currentStep === 1) {
      programmaticScrollPendingRef.current = false;
      setAgentFabWindowRect(null);
    }
  }, [currentStep]);

  useEffect(
    () => () => {
      if (agentFabMeasureRafRef.current != null) {
        cancelAnimationFrame(agentFabMeasureRafRef.current);
        agentFabMeasureRafRef.current = null;
      }
    },
    [],
  );

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
    if (getAgentFabMotionMode() === 'user') {
      notifyCreateMeetingAgentBubbleShow();
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
    if (specialtyKind === 'sports' && activeLifeMajor && activityKinds.length === 0) {
      setWizardError('활동 종류를 한 가지 선택해 주세요.');
      return;
    }
    if (specialtyKind === 'sports' && (playAndVibeMajor || pcGameMajor) && gameKinds.length === 0) {
      setWizardError(pcGameMajor ? 'PC 게임을 한 가지 선택해 주세요.' : '게임 종류를 한 가지 선택해 주세요.');
      return;
    }
    if (specialtyKind === 'knowledge' && focusKnowledgePreferences.length === 0) {
      setWizardError('모임 성격을 한 가지 선택해 주세요.');
      return;
    }
    if (getAgentFabMotionMode() === 'user') {
      notifyCreateMeetingAgentBubbleShow();
    }
    pendingScrollAfterStepRef.current = 3;
    setCurrentStep(3);
  }, [
    activeLifeMajor,
    playAndVibeMajor,
    pcGameMajor,
    activityKinds.length,
    gameKinds.length,
    focusKnowledgePreferences.length,
    menuPreferences.length,
    movieCandidates.length,
    specialtyKind,
  ]);

  const onStep1NextRef = useRef(onStep1Next);
  const onStep2SpecialtyNextRef = useRef(onStep2SpecialtyNext);
  const onStep3BasicNextRef = useRef(() => {});
  onStep1NextRef.current = onStep1Next;
  onStep2SpecialtyNextRef.current = onStep2SpecialtyNext;

  const applyWizardSuggestion = useCallback(
    (sugg: WizardSuggestion) => {
      setAgentFabMotionMode('auto');
      layoutAnimateMeetingCreateWizard();

      void (async () => {
        const runId = ++agentWizardApplyRunIdRef.current;
        const isApplyRunAlive = () => runId === agentWizardApplyRunIdRef.current;
        const tapHoldMs = AGENT_APPLY_TAP_HOLD_MS;
        const stepGapMs = AGENT_APPLY_STEP_GAP_MS;

        const runFallbackImmediate = () => {
          setSelectedCategoryId(sugg.categoryId);
          const cat0 = categories.find((c) => c.id === sugg.categoryId) ?? null;
          const sk0 = resolveSpecialtyKindForCategory(cat0);
          if (sk0 === 'food' && sugg.menuPreferenceLabel) {
            setMenuPreferences([sugg.menuPreferenceLabel]);
          }
          suppressStepLayoutAnimateFromCategoryRef.current = true;
          setTimeout(() => {
            onStep1NextRef.current();
            if (sugg.canAutoCompleteThroughStep3 && sk0 === 'food' && sugg.menuPreferenceLabel) {
              setTimeout(() => onStep2SpecialtyNextRef.current(), 80);
            }
          }, 80);
        };

        try {
          if (currentStepRef.current !== 1) {
            runFallbackImmediate();
            return;
          }

          await waitAgentStep1FabUnlocked();
          await sleep(stepGapMs);

          const catForSk = categories.find((c) => c.id === sugg.categoryId) ?? null;
          const sk = resolveSpecialtyKindForCategory(catForSk);

          setAgentWizardApplyCue({ kind: 'category', id: sugg.categoryId });
          await sleep(tapHoldMs);
          setSelectedCategoryId(sugg.categoryId);
          setAgentWizardApplyCue(null);
          await sleep(stepGapMs);

          const pubTarget = sugg.suggestedIsPublic;
          if (pubTarget != null && pubTarget !== isPublicMeetingRef.current) {
            setAgentWizardApplyCue({ kind: 'public', side: pubTarget ? 'public' : 'private' });
            await sleep(tapHoldMs);
            setIsPublicMeeting(pubTarget);
            setAgentWizardApplyCue(null);
            await sleep(stepGapMs);
          } else {
            setAgentWizardApplyCue({
              kind: 'public',
              side: isPublicMeetingRef.current ? 'public' : 'private',
            });
            await sleep(AGENT_APPLY_QUICK_ACK_MS);
            setAgentWizardApplyCue(null);
            await sleep(stepGapMs);
          }

          setAgentWizardApplyCue({ kind: 'confirm1' });
          await sleep(tapHoldMs);
          setAgentWizardApplyCue(null);
          await sleep(stepGapMs);

          suppressStepLayoutAnimateFromCategoryRef.current = true;
          onStep1NextRef.current();

          const needsSpecAfter = catForSk ? categoryNeedsSpecialty(catForSk) : false;
          let reachedBasicStep = false;

          if (sugg.canAutoCompleteThroughStep3 && sk === 'food' && sugg.menuPreferenceLabel) {
            await new Promise<void>((r) => {
              InteractionManager.runAfterInteractions(() => r());
            });
            await sleep(AGENT_APPLY_POST_LAYOUT_MS);
            setAgentWizardApplyCue({ kind: 'menu', label: sugg.menuPreferenceLabel });
            await sleep(tapHoldMs);
            setMenuPreferences([sugg.menuPreferenceLabel]);
            setAgentWizardApplyCue(null);
            await sleep(stepGapMs);
            setAgentWizardApplyCue({ kind: 'confirm2' });
            await sleep(tapHoldMs);
            setAgentWizardApplyCue(null);
            await sleep(stepGapMs);
            onStep2SpecialtyNextRef.current();
            reachedBasicStep = true;
          } else if (!needsSpecAfter) {
            reachedBasicStep = true;
          }

          if (!reachedBasicStep) {
            return;
          }

          await new Promise<void>((r) => {
            InteractionManager.runAfterInteractions(() => r());
          });
          await sleep(AGENT_APPLY_POST_LAYOUT_MS);

          const rules = resolveMeetingCreateRules(catForSk?.majorCode ?? null);
          const pub = isPublicMeetingRef.current;
          const { min, max } = clampAutoWizardParticipants(
            pub,
            sugg.autoBasicInfo.avgMinParticipants,
            sugg.autoBasicInfo.avgMaxParticipants,
            rules,
          );
          setMinParticipants(min);
          setMaxParticipants(max);
          await typewriterAutoMeetingTitle({
            fullTitle: sugg.autoBasicInfo.title,
            setTitle,
            isAlive: isApplyRunAlive,
            msPerCodePoint: AGENT_APPLY_TITLE_MS_PER_CODEPOINT,
          });
          if (!isApplyRunAlive()) return;
          await sleep(64);
          onStep3BasicNextRef.current();
          if (!isApplyRunAlive()) return;

          await new Promise<void>((r) => {
            InteractionManager.runAfterInteractions(() => r());
          });
          await sleep(AGENT_APPLY_POST_LAYOUT_MS);

          let formReady: VoteCandidatesFormHandle | null = null;
          for (let i = 0; i < 48; i += 1) {
            formReady = scheduleFormRef.current;
            if (formReady?.playAgentSchedulePickAnimation) break;
            await sleep(55);
            if (!isApplyRunAlive()) return;
          }
          if (!formReady?.playAgentSchedulePickAnimation || !isApplyRunAlive()) return;

          await formReady.playAgentSchedulePickAnimation({
            ymd: sugg.autoSchedule.ymd,
            hm: sugg.autoSchedule.hm,
            isAlive: isApplyRunAlive,
          });
          if (!isApplyRunAlive()) return;
          await sleep(stepGapMs);
          setAgentWizardApplyCue({ kind: 'confirmSchedule' });
          await sleep(tapHoldMs);
          setAgentWizardApplyCue(null);
          await sleep(stepGapMs);
          await handleConfirmScheduleRef.current();
        } catch {
          setAgentWizardApplyCue(null);
        } finally {
          setAgentFabMotionMode('user');
        }
      })();
    },
    [categories],
  );

  const onStep3BasicNext = useCallback(() => {
    setWizardError(null);
    if (!title.trim()) {
      setTitle(effectiveMeetingTitle);
    }
    const capMax = meetingCreateRules.capacityMax;
    const minFloor = Math.max(PARTICIPANT_COUNT_MIN, meetingCreateRules.minParticipantsFloor);
    if (isPublicMeeting) {
      if (!Number.isFinite(minParticipants) || minParticipants < minFloor || minParticipants > capMax) {
        setWizardError('최소 인원을 선택해 주세요.');
        return;
      }
      if (
        !Number.isFinite(maxParticipants) ||
        (maxParticipants !== CAPACITY_UNLIMITED && maxParticipants < minFloor) ||
        maxParticipants < minParticipants ||
        (maxParticipants > capMax && maxParticipants !== CAPACITY_UNLIMITED)
      ) {
        setWizardError('최대 인원을 선택해 주세요.');
        return;
      }
    } else {
      if (
        !Number.isFinite(minParticipants) ||
        minParticipants < minFloor ||
        minParticipants > capMax ||
        minParticipants !== maxParticipants ||
        maxParticipants === CAPACITY_UNLIMITED
      ) {
        setWizardError('참석 인원을 선택해 주세요.');
        return;
      }
    }
    if (getAgentFabMotionMode() === 'user') {
      notifyCreateMeetingAgentBubbleShow();
    }
    pendingScrollAfterStepRef.current = 4;
    setCurrentStep(4);
  }, [
    effectiveMeetingTitle,
    isPublicMeeting,
    maxParticipants,
    meetingCreateRules.capacityMax,
    meetingCreateRules.minParticipantsFloor,
    minParticipants,
    title,
  ]);

  onStep3BasicNextRef.current = onStep3BasicNext;

  const handleConfirmSchedule = useCallback(async () => {
    setWizardError(null);
    const r = await scheduleFormRef.current?.validateScheduleStep();
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
    if (getAgentFabMotionMode() === 'user') {
      notifyCreateMeetingAgentBubbleShow();
    }
    setCurrentStep(placesStep);
  }, [placesStep]);

  useEffect(() => {
    handleConfirmScheduleRef.current = handleConfirmSchedule;
  }, [handleConfirmSchedule]);

  const onPlacesStepConfirm = useCallback(() => {
    setWizardError(null);
    const r = placesFormRef.current?.validatePlacesStep();
    if (!r?.ok) {
      setWizardError(r?.error ?? '장소 후보를 확인해 주세요.');
      return;
    }
    pendingScrollAfterStepRef.current = detailStep;
    if (getAgentFabMotionMode() === 'user') {
      notifyCreateMeetingAgentBubbleShow();
    }
    setCurrentStep(detailStep);
  }, [detailStep]);

  const handleBack = useCallback(() => {
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
    const capMax = meetingCreateRules.capacityMax;
    const minFloor = Math.max(PARTICIPANT_COUNT_MIN, meetingCreateRules.minParticipantsFloor);
    const feeMax = meetingCreateRules.membershipFeeWonMax;
    if (isPublicMeeting) {
      if (!Number.isFinite(minParticipants) || minParticipants < minFloor || minParticipants > capMax) {
        setWizardError('최소 인원을 선택해 주세요.');
        Alert.alert('입력 확인', '최소 인원을 선택해 주세요.');
        return;
      }
      if (
        !Number.isFinite(maxParticipants) ||
        (maxParticipants !== CAPACITY_UNLIMITED && maxParticipants < minFloor) ||
        maxParticipants < minParticipants ||
        (maxParticipants > capMax && maxParticipants !== CAPACITY_UNLIMITED)
      ) {
        setWizardError('최대 인원을 선택해 주세요.');
        Alert.alert('입력 확인', '최대 인원을 선택해 주세요.');
        return;
      }
      if (
        meetingConfig.settlement === 'MEMBERSHIP_FEE' &&
        (typeof meetingConfig.membershipFeeWon !== 'number' ||
          !Number.isFinite(meetingConfig.membershipFeeWon) ||
          meetingConfig.membershipFeeWon < 1)
      ) {
        setWizardError('회비 금액을 입력해 주세요.');
        Alert.alert('입력 확인', '회비를 선택한 경우 1원 이상의 금액을 입력해 주세요.');
        return;
      }
      if (meetingConfig.settlement === 'MEMBERSHIP_FEE' && typeof meetingConfig.membershipFeeWon === 'number') {
        if (meetingConfig.membershipFeeWon > feeMax) {
          const wonLabel = `${feeMax.toLocaleString('ko-KR')}원`;
          setWizardError(`회비는 최대 ${wonLabel}까지 입력할 수 있어요.`);
          Alert.alert('입력 확인', `회비는 최대 ${wonLabel}까지 입력할 수 있어요.`);
          return;
        }
      }
    } else {
      if (
        !Number.isFinite(minParticipants) ||
        minParticipants < minFloor ||
        minParticipants > capMax ||
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
    if (specialtyKind === 'sports' && activeLifeMajor && activityKinds.length === 0) {
      setWizardError('활동 종류를 한 가지 선택해 주세요.');
      Alert.alert('입력 확인', '활동 종류를 한 가지 선택해 주세요.');
      return;
    }
    if (specialtyKind === 'sports' && (playAndVibeMajor || pcGameMajor) && gameKinds.length === 0) {
      const msg = pcGameMajor ? 'PC 게임을 한 가지 선택해 주세요.' : '게임 종류를 한 가지 선택해 주세요.';
      setWizardError(msg);
      Alert.alert('입력 확인', msg);
      return;
    }
    if (specialtyKind === 'knowledge' && focusKnowledgePreferences.length === 0) {
      setWizardError('모임 성격을 한 가지 선택해 주세요.');
      Alert.alert('입력 확인', '모임 성격을 한 가지 선택해 주세요.');
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

    let hostProfile: UserProfile | null = null;
    try {
      hostProfile = await getUserProfile(userId.trim());
      const uid = userId.trim();
      if (!hostProfile || !isMeetingServiceComplianceComplete(hostProfile, uid)) {
        Alert.alert('인증 정보 등록', '모임을 이용하시려면 약관 동의와 필요한 프로필 정보를 입력해 주세요.', [
          { text: '확인', onPress: () => pushProfileOpenRegisterInfo(router) },
        ]);
        return;
      }
    } catch {
      /* 네트워크 오류 시에는 등록 시도는 계속(서버/클라이언트 재검증) */
    }

    const meetingConfigForSave: PublicMeetingDetailsConfig | null = isPublicMeeting
      ? meetingConfig.genderRatio === 'SAME_GENDER_ONLY'
        ? {
            ...meetingConfig,
            hostGenderSnapshot: normalizeProfileGenderToHostSnapshot(hostProfile?.gender ?? null),
          }
        : meetingConfig
      : null;

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
            activityKinds: specialtyKind === 'sports' && activeLifeMajor ? activityKinds : undefined,
            gameKinds:
              specialtyKind === 'sports' && (playAndVibeMajor || pcGameMajor) ? gameKinds : undefined,
            focusKnowledgePreferences:
              specialtyKind === 'knowledge' ? focusKnowledgePreferences : undefined,
            categoryMajorCode: selectedCategory?.majorCode ?? null,
          })
        : null;

    const lat = Number(p0.latitude);
    const lng = Number(p0.longitude);
    const cap = toFiniteInt(maxParticipants, 4);
    const minP = toFiniteInt(minParticipants, PARTICIPANT_COUNT_MIN);

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
        meetingConfig: meetingConfigForSave,
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
    meetingCreateRules.capacityMax,
    meetingCreateRules.membershipFeeWonMax,
    meetingCreateRules.minParticipantsFloor,
    minParticipants,
    userId,
    router,
    selectedCategory?.id,
    selectedCategory?.label,
    specialtyKind,
    movieCandidates,
    menuPreferences,
    activityKinds,
    gameKinds,
    focusKnowledgePreferences,
    activeLifeMajor,
    playAndVibeMajor,
    pcGameMajor,
    selectedCategory?.majorCode,
    meetingConfig,
  ]);

  /** 등록 버튼: 로딩 중만 비활성화. 소개글 길이는 눌렀을 때 검증(짧으면 안내). */
  const finalDisabled = busy;

  return (
    <View style={styles.screenRoot}>
      <CreateMeetingAgenticAiProvider>
        <CreateMeetingAgenticAiBootstrap />
        <CreateMeetingWizardAgentBridge
          currentStep={currentStep}
          scheduleStep={scheduleStep}
          placesStep={placesStep}
          detailStep={detailStep}
          seedDate={seedDate}
          seedTime={seedTime}
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          applyWizardSuggestion={applyWizardSuggestion}
          placesFormRef={placesFormRef}
        />
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
                onPress={() => pushProfileOpenRegisterInfo(router)}
                style={({ pressed }) => [styles.snsGateBtn, pressed && { opacity: 0.88 }]}
                accessibilityRole="button"
                accessibilityLabel="정보 등록 화면으로 이동">
                <Text style={styles.snsGateBtnLabel}>정보 등록하기</Text>
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
                scrollEventThrottle: 16,
                onScroll: (e) => {
                  mainScrollYRef.current = e.nativeEvent.contentOffset.y;
                  if (!programmaticScrollPendingRef.current && getAgentFabMotionMode() === 'user') {
                    const now = Date.now();
                    if (now - scrollDismissLastNotifyMsRef.current >= 160) {
                      scrollDismissLastNotifyMsRef.current = now;
                      notifyCreateMeetingAgentBubbleDismissFromManualScroll();
                    }
                  }
                },
                onMomentumScrollEnd: () => {
                  onAgentFabMainScrollSettled();
                },
                onScrollEndDrag: () => {
                  onAgentFabMainScrollSettled();
                },
                onScrollBeginDrag: () => {
                  if (getAgentFabMotionMode() === 'user') {
                    notifyCreateMeetingAgentBubbleDismissFromManualScroll();
                  }
                },
                /**
                 * 손가락 플링(손을 뗀 뒤 관성)에만 적용. 단계 이동용 `scrollTo(..., animated: true)`는
                 * RN Android가 고정 길이(~250ms) 애니메이터로 처리해 이 값과 무관합니다.
                 */
                decelerationRate: Platform.OS === 'ios' ? 0.9999 : 0.999,
                /** 키보드 열릴 때 자동 스크롤 보정을 조금 더 천천히 */
                keyboardOpeningTime: 400,
              }}
              contentContainerStyle={[
                styles.scrollContent,
                styles.wizardScrollPad,
                // 상세 단계: 하단 floating CTA가 마지막 카드를 가리지 않도록 추가 여백 확보
                currentStep === detailStep && { paddingBottom: 132 + insets.bottom },
              ]}>
              <View collapsable={false}>
              <View style={styles.wizardStepShell} onLayout={(e) => captureStepPosition(1, e)}>
                <Text style={styles.wizardStepBadge}>모임 성격</Text>

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
                  <Text style={styles.wizardMuted}>등록된 카테고리가 없습니다. Firestore `categories` 또는 Supabase `meeting_categories`를 확인해 주세요.</Text>
                ) : null}

                <View style={styles.catGrid}>
                  {categories.map((c) => {
                    const active = c.id === selectedCategoryId;
                    const agentCatCue = agentWizardApplyCue?.kind === 'category' && agentWizardApplyCue.id === c.id;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => requestCategorySelect(c.id)}
                        style={({ pressed }) => [
                          styles.catTile,
                          active && styles.catTileActive,
                          (pressed || agentCatCue) && styles.catTilePressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}>
                        <AgentApplyRippleLayer active={agentCatCue} />
                        <Text style={styles.catEmoji}>{c.emoji}</Text>
                        <Text style={[styles.catLabel, active && styles.catLabelActive]} numberOfLines={2}>
                          {c.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.wizardFieldLabel, { marginTop: 18 }]}>공개 / 비공개</Text>
                <VoteCandidateCard
                  reduceHeavyEffects={reduceHeavyEffectsUI}
                  outerStyle={styles.wizardGlassCard}
                  wrapStyleOverride={styles.flatWrapNoShadow}>
                  <View style={styles.segmentRow}>
                    <Pressable
                      onPress={() => setIsPublicMeeting(false)}
                      style={[
                        styles.segmentHalf,
                        !isPublicMeeting && styles.segmentHalfOn,
                        agentWizardApplyCue?.kind === 'public' &&
                          agentWizardApplyCue.side === 'private' &&
                          styles.segmentHalfAgentCue,
                      ]}
                      accessibilityRole="button">
                      <AgentApplyRippleLayer
                        active={
                          agentWizardApplyCue?.kind === 'public' && agentWizardApplyCue.side === 'private'
                        }
                        size="md"
                      />
                      <Text style={[styles.segmentTitle, !isPublicMeeting && styles.segmentTitleOn]}>🔒 비공개</Text>
                      <Text style={styles.segmentSub}>(초대만)</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setIsPublicMeeting(true)}
                      style={[
                        styles.segmentHalf,
                        isPublicMeeting && styles.segmentHalfOn,
                        agentWizardApplyCue?.kind === 'public' &&
                          agentWizardApplyCue.side === 'public' &&
                          styles.segmentHalfAgentCue,
                      ]}
                      accessibilityRole="button">
                      <AgentApplyRippleLayer
                        active={
                          agentWizardApplyCue?.kind === 'public' && agentWizardApplyCue.side === 'public'
                        }
                        size="md"
                      />
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
                      (pressed || agentWizardApplyCue?.kind === 'confirm1') &&
                        selectedCategoryId &&
                        categories.length > 0 &&
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
                    <AgentApplyRippleLayer
                      active={agentWizardApplyCue?.kind === 'confirm1'}
                      size="lg"
                    />
                    <Text style={styles.wizardPrimaryBtnLabel}>
                      {needsSpecialty ? '확인' : '확인'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {selectedCategory != null && needsSpecialty && specialtyKind && currentStep >= 2 ? (
                <View
                  ref={(n) => {
                    agentStepShellRefs.current[2] = n;
                  }}
                  collapsable={false}
                  style={styles.wizardStepShell}
                  onLayout={(e) => onWizardStepShellLayout(2, e)}>
                  <Text style={[styles.wizardStepBadge, { marginTop: 0 }]}>
                    {specialtyStepBadge(specialtyKind, selectedCategory?.majorCode ?? null)}
                  </Text>
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
                    <MenuPreference
                      value={menuPreferences}
                      onChange={setMenuPreferences}
                      disabled={busy}
                      agentCueLabel={
                        agentWizardApplyCue?.kind === 'menu' ? agentWizardApplyCue.label : null
                      }
                    />
                  ) : null}
                  {specialtyKind === 'sports' && activeLifeMajor ? (
                    <ActivityKindPreference value={activityKinds} onChange={setActivityKinds} disabled={busy} />
                  ) : null}
                  {specialtyKind === 'sports' && playAndVibeMajor ? (
                    <GameKindPreference value={gameKinds} onChange={setGameKinds} disabled={busy} />
                  ) : null}
                  {specialtyKind === 'sports' && pcGameMajor ? (
                    <PcGameKindPreference value={gameKinds} onChange={setGameKinds} disabled={busy} />
                  ) : null}
                  {specialtyKind === 'knowledge' ? (
                    <FocusKnowledgePreference
                      value={focusKnowledgePreferences}
                      onChange={setFocusKnowledgePreferences}
                      disabled={busy}
                    />
                  ) : null}
                  {currentStep === 2 ? (
                    <Pressable
                      onPress={onStep2SpecialtyNext}
                      disabled={
                        busy ||
                        (specialtyKind === 'movie' && movieCandidates.length === 0) ||
                        (specialtyKind === 'food' && menuPreferences.length === 0) ||
                        (specialtyKind === 'sports' && activeLifeMajor && activityKinds.length === 0) ||
                        (specialtyKind === 'sports' &&
                          (playAndVibeMajor || pcGameMajor) &&
                          gameKinds.length === 0) ||
                        (specialtyKind === 'knowledge' && focusKnowledgePreferences.length === 0)
                      }
                      style={({ pressed }) => {
                        const step2Disabled =
                          (specialtyKind === 'movie' && movieCandidates.length === 0) ||
                          (specialtyKind === 'food' && menuPreferences.length === 0) ||
                          (specialtyKind === 'sports' && activeLifeMajor && activityKinds.length === 0) ||
                          (specialtyKind === 'sports' &&
                            (playAndVibeMajor || pcGameMajor) &&
                            gameKinds.length === 0) ||
                          (specialtyKind === 'knowledge' && focusKnowledgePreferences.length === 0);
                        return [
                          styles.wizardPrimaryBtn,
                          step2Disabled ? styles.addCandidateBtnDisabled : undefined,
                          (pressed || agentWizardApplyCue?.kind === 'confirm2') &&
                            !step2Disabled &&
                            styles.addCandidateBtnPressed,
                        ];
                      }}
                      accessibilityRole="button">
                      <View pointerEvents="none" style={styles.wizardPrimaryBtnBg}>
                        <LinearGradient
                          colors={GinitTheme.colors.ctaGradient}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={StyleSheet.absoluteFillObject}
                        />
                      </View>
                      <AgentApplyRippleLayer
                        active={agentWizardApplyCue?.kind === 'confirm2'}
                        size="lg"
                      />
                      <Text style={styles.wizardPrimaryBtnLabel}>
                        {specialtyKind === 'movie'
                          ? '이 후보들로 모임 만들기'
                          : '확인'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {currentStep >= 3 ? (
                <View
                  ref={(n) => {
                    agentStepShellRefs.current[3] = n;
                  }}
                  collapsable={false}
                  style={styles.wizardStepShell}
                  onLayout={(e) => onWizardStepShellLayout(3, e)}>
                  <Text style={styles.wizardStepBadge}>기본 정보</Text>
                  <Text style={styles.wizardFieldLabel}>모임 이름</Text>  
                    <LinearGradient
                      colors={[...GinitTheme.colors.brandGradient, GinitTheme.colors.ctaGradient[1]]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[styles.aiQuickInitBorder, { marginBottom: 0 }]}>
                      <View style={[styles.aiQuickInitInner, { minHeight: 0, paddingVertical: 10 }]}>
                        <View style={styles.voiceInputRow}>
                          <TextInput
                            ref={meetingTitleInputRef}
                            {...meetingTitleDeferKb}
                            value={title}
                            onChangeText={setTitle}
                            placeholder={
                              aiTitleSuggestions[0] ? `예: ${aiTitleSuggestions[0]}` : '모임 이름을 입력하세요'
                            }
                            placeholderTextColor={INPUT_PLACEHOLDER}
                            style={[styles.aiQuickInitInput, styles.voiceInput, { minHeight: 0 }]}
                            editable={!busy}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="default"
                            inputMode="text"
                            underlineColorAndroid="transparent"
                          />
                          <Pressable
                            onPress={onPressVoiceInputTitle}
                            style={({ pressed }) => [styles.voiceBtn, pressed && styles.voiceBtnPressed]}
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel="모임 이름 음성 입력">
                            {voiceTitleRecognizing ? (
                              <VoiceWaveform active color={GinitTheme.colors.primary} />
                            ) : (
                              <GinitSymbolicIcon name="mic" size={18} color={GinitTheme.colors.primary} />
                            )}
                          </Pressable>
                        </View>
                      </View>
                    </LinearGradient>
                    <Text style={[styles.wizardFieldHint, { marginTop: 6 }]}>
                    ✨ 입력하지 않으셔도 AI 추천(또는 자동 생성) 제목이 등록됩니다.
                    </Text>
                    {aiTitleSuggestions.length > 0 ? (
                      <View style={styles.aiTitlePickBlock}>
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
                      <Text style={styles.wizardPrimaryBtnLabel}>확인</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {currentStep >= scheduleStep ? (
                <>
                    <View
                      ref={(n) => {
                        agentStepShellRefs.current[scheduleStep] = n;
                      }}
                      collapsable={false}
                      style={styles.wizardStepShell}
                      onLayout={(e) => onWizardStepShellLayout(scheduleStep, e)}>
                      <View style={styles.scheduleStepHeader}>
                        <Text style={styles.wizardStepBadge}>일정 설정</Text>
                        {/* <Text style={styles.wizardLockedHint}>
                          {currentStep === scheduleStep
                            ? '하거나 카드에서 일시 후보를 다듬어 주세요.'
                            : '확정한 일시 후보예요. 필요하면 이전 단계로 돌아가 수정할 수 있어요.'}
                        </Text> */}
                      </View>

                      {currentStep === scheduleStep ? (
                        <>
                          <View
                            style={styles.wizardFormMount}
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
                              placeThemeSpecialtyKind={specialtyKind}
                              placeMenuPreferenceLabels={placeMenuPreferenceLabelsForPlaceQuery}
                              placeThemeMajorCode={selectedCategory?.majorCode ?? null}
                              placeActivityKindLabels={placeActivityKindLabelsForPlaceQuery}
                              placeGameKindLabels={placeGameKindLabelsForPlaceQuery}
                              placeFocusKnowledgePreferenceLabels={placeFocusKnowledgePreferenceLabelsForPlaceQuery}
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
                            style={({ pressed }) => [
                              styles.wizardPrimaryBtn,
                              (pressed || agentWizardApplyCue?.kind === 'confirmSchedule') &&
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
                            <AgentApplyRippleLayer
                              active={agentWizardApplyCue?.kind === 'confirmSchedule'}
                              size="lg"
                            />
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
                            placeThemeSpecialtyKind={specialtyKind}
                            placeMenuPreferenceLabels={placeMenuPreferenceLabelsForPlaceQuery}
                            placeThemeMajorCode={selectedCategory?.majorCode ?? null}
                            placeActivityKindLabels={placeActivityKindLabelsForPlaceQuery}
                            placeGameKindLabels={placeGameKindLabelsForPlaceQuery}
                            placeFocusKnowledgePreferenceLabels={placeFocusKnowledgePreferenceLabelsForPlaceQuery}
                            initialPayload={votePayload}
                            bare
                            wizardSegment="schedule"
                            scheduleListOnly
                            placesListOnly
                          />
                        </View>
                      ) : null}
                    </View>

                  {currentStep >= placesStep ? (
                    <View
                      ref={(n) => {
                        agentStepShellRefs.current[placesStep] = n;
                      }}
                      collapsable={false}
                      style={styles.wizardStepShell}
                      onLayout={(e) => onWizardStepShellLayout(placesStep, e)}>
                      <View
                        ref={placesStepHeaderAnchorRef}
                        collapsable={false}
                        style={styles.placesStepHeader}>
                        <Text style={styles.wizardStepBadge}>장소 후보</Text>
                      </View>

                      <View style={styles.wizardFormMount}>
                        <VoteCandidatesForm
                          ref={placesFormRef}
                          key={`wiz-places-${voteHydrateKey}`}
                          seedPlaceQuery={seedQ}
                          seedScheduleDate={seedDate}
                          seedScheduleTime={seedTime}
                          placeThemeLabel={selectedCategory?.label ?? ''}
                          placeThemeSpecialtyKind={specialtyKind}
                          placeMenuPreferenceLabels={placeMenuPreferenceLabelsForPlaceQuery}
                          placeThemeMajorCode={selectedCategory?.majorCode ?? null}
                          placeActivityKindLabels={placeActivityKindLabelsForPlaceQuery}
                          placeGameKindLabels={placeGameKindLabelsForPlaceQuery}
                          placeFocusKnowledgePreferenceLabels={placeFocusKnowledgePreferenceLabelsForPlaceQuery}
                          placeMinParticipants={isPublicMeeting ? undefined : minParticipants}
                          placeMaxParticipants={isPublicMeeting ? undefined : maxParticipants}
                          initialPayload={votePayload}
                          bare
                          wizardSegment="places"
                          scheduleListOnly={true}
                          placesListOnly={false}
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
                          <Text style={styles.wizardPrimaryBtnLabel}>확인</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}

                  {currentStep >= detailStep ? (
                    <View
                      ref={(n) => {
                        agentStepShellRefs.current[detailStep] = n;
                      }}
                      collapsable={false}
                      style={styles.wizardStepShell}
                      onLayout={(e) => onWizardStepShellLayout(detailStep, e)}>
                      <Text style={[styles.wizardStepBadge, { marginTop: 2 }]}>상세 조건 (선택)</Text>
                      <Text style={styles.wizardLockedHint}>
                        위에서 확정한 일정을 확인한 뒤 등록해 주세요. 소개를 비워 두면 지닛이 맞춤 소개글을
                        자동으로 넣어 드려요.
                      </Text>

                      {isPublicMeeting ? (
                        <>
                          <Text style={[styles.wizardFieldLabel, { marginTop: 12 }]}>공개 모임</Text>
                          <VoteCandidateCard
                            reduceHeavyEffects={reduceHeavyEffectsUI}
                            outerStyle={styles.wizardPublicMeetingDetailsCardOuter}
                            wrapStyleOverride={[
                              styles.flatWrapNoShadow,
                              styles.wizardPublicMeetingDetailsWrapOverride,
                            ]}>
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
                        outerStyle={[
                          styles.wizardGlassCard,
                          styles.finalRegistrationGlass,
                          styles.detailStepDescriptionCardOuter,
                        ]}
                        wrapStyleOverride={styles.flatWrapNoShadow}>
                        <View style={styles.detailDescriptionInputShell}>
                          <TextInput
                            ref={detailDescriptionInputRef}
                            {...detailDescriptionDeferKb}
                            value={description}
                            onChangeText={setDescription}
                            placeholder={descriptionPlaceholder}
                            placeholderTextColor={INPUT_PLACEHOLDER}
                            style={[
                              styles.finalDescriptionInput,
                              styles.finalDescriptionInputWithVoiceFab,
                              descFocused && styles.finalDescriptionInputFocused,
                            ]}
                            multiline
                            textAlignVertical="top"
                            editable={!busy}
                            keyboardType="default"
                            inputMode="text"
                          />
                          <Pressable
                            onPress={onPressVoiceInputDescription}
                            disabled={busy}
                            style={({ pressed }) => [
                              styles.voiceBtn,
                              styles.detailDescriptionVoiceFab,
                              busy && styles.addCandidateBtnDisabled,
                              pressed && !busy && styles.voiceBtnPressed,
                            ]}
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel="모임 소개 음성 입력">
                            {voiceDescriptionRecognizing ? (
                              <VoiceWaveform active color={GinitTheme.colors.primary} />
                            ) : (
                              <GinitSymbolicIcon name="mic" size={18} color={GinitTheme.colors.primary} />
                            )}
                          </Pressable>
                        </View>
                      </VoteCandidateCard>
                    </View>
                  ) : null}
                </>
              ) : null}
              </View>
            </KeyboardAwareScreenScroll>
          </View>

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
                <Text style={styles.detailFinalFloatingLabel}>지닛 시작하기</Text>
              )}
            </Pressable>
          ) : null}

          {wizardError ? (
            <Text pointerEvents="none" style={styles.wizardFloatingError}>
              {wizardError}
            </Text>
          ) : null}
      </SafeAreaView>
      {!snsDemographicsBlocked ? (
        <CreateMeetingAgenticAiFab
          layoutMode={aiFabScreenBottomLayout ? 'screenBottom' : 'cardTopRight'}
          cardWindowRect={aiFabScreenBottomLayout ? null : agentFabWindowRect}
          windowWidth={windowWidth}
          wizardStep={currentStep}
        />
      ) : null}
      </CreateMeetingAgenticAiProvider>
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
    paddingTop: 10,
    paddingBottom: 8,
    marginBottom: 4,
    gap: 8,
  },
  snsGateBanner: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(244, 200, 74, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(244, 200, 74, 0.55)',
    gap: 8,
  },
  snsGateTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  snsGateBody: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
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
    fontWeight: '600',
    color: GinitTheme.colors.textOnDark,
  },
  backLink: {
    fontSize: 16,
    fontWeight: '700',
    color: GinitTheme.colors.text,
    minWidth: 56,
  },
  screenTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
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
    fontWeight: '600',
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
    fontWeight: '600',
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
  voiceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceInput: {
    flex: 1,
  },
  voiceBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(31, 42, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(31, 42, 68, 0.45)',
  },
  voiceBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  voiceWaveWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
    height: 18,
  },
  voiceWaveBar: {
    width: 3,
    height: 18,
    borderRadius: 2,
    opacity: 0.95,
  },
  aiPreviewRow: {
    marginTop: 2,
    marginBottom: 8,
    gap: 8,
  },
  aiPreviewHint: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  aiPreviewScroll: {
    gap: 8,
    paddingBottom: 2,
    paddingRight: 0,
  },
  /** `PublicMeetingDetailsCard` 모집 연령대 칩과 동일 스펙 */
  aiPreviewScheduleChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: Platform.OS === 'android' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.55)',
    paddingVertical: 9,
    paddingHorizontal: 12,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  aiPreviewScheduleChipCarousel: {
    width: 220,
    flexShrink: 0,
  },
  aiPreviewScheduleChipFull: {
    width: '100%',
    alignSelf: 'stretch',
  },
  aiPreviewScheduleChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  aiPreviewScheduleChipHint: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  aiPreviewScheduleChipPlaceholder: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: Platform.OS === 'android' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.55)',
    paddingVertical: 9,
    paddingHorizontal: 12,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  aiPreviewScheduleChipPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
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
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  aiPreviewClickableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  aiPreviewPlusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  aiPreviewPlusText: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
    letterSpacing: -0.1,
  },
  aiQuickInitCta: {
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: GinitTheme.fixedGlassCard.border,
    ...GinitTheme.shadow.card,
  },
  aiQuickInitCtaBg: {
    ...StyleSheet.absoluteFillObject,
  },
  aiQuickInitCtaLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: GinitTheme.colors.text,
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
    backgroundColor: 'rgba(31, 42, 68, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(31, 42, 68, 0.45)',
  },
  nlpChipPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  nlpChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textOnDark,
    letterSpacing: -0.2,
  },
  sectionGap: {
    marginTop: 18,
  },
  /** 글래스 카드: shadow wrapper + clip inner (Android elevation 안전) */
  glassCardWrap: {
    marginBottom: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(31, 42, 68, 0.04)',
    shadowColor: GinitTheme.shadow.card.shadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 14,
  },
  flatWrapNoShadow: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  glassCardInner: {
    borderRadius: 24,
    padding: 14,
    backgroundColor: 'rgba(31, 42, 68, 0.04)',
    borderWidth: 1.5,
    borderColor: 'rgba(31, 42, 68, 0.18)',
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
    backgroundColor: GinitTheme.glass.overlayDark,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  cardFieldTitleNoDeleteOffset: {
    paddingRight: 0,
  },
  deleteIconText: {
    color: GinitTheme.colors.textOnDark,
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
    backgroundColor: 'rgba(31, 42, 68, 0.04)', // 네이비 틴트
    borderColor: GinitTheme.colors.borderStrong,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  placeFieldRecess: {
    backgroundColor: 'rgba(31, 42, 68, 0.04)',
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
    backgroundColor: 'rgba(31, 42, 68, 0.04)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  placeSuggestChipPressed: {
    opacity: 0.9,
    backgroundColor: 'rgba(31, 42, 68, 0.10)',
    borderColor: 'rgba(31, 42, 68, 0.45)',
  },
  placeSuggestChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    maxWidth: 220,
  },
  scheduleCalendarWrap: {
    marginTop: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    overflow: 'hidden',
  },
  scheduleCalendarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  scheduleCalendarTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    letterSpacing: -0.2,
  },
  scheduleCalendarTitlePress: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  scheduleCalendarCarouselHost: {
    width: '100%',
    height: 274,
  },
  scheduleCalendarPagerScroll: {
    flex: 1,
    minHeight: 0,
  },
  scheduleCalendarPagerContent: {
    paddingVertical: 10,
    paddingHorizontal: 0,
  },
  calendarNavBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(31, 42, 68, 0.04)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  calendarNavBtnPressed: {
    opacity: 0.9,
  },
  calendarDowRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
  },
  calendarDowText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  calendarGrid: {
    paddingHorizontal: 8,
    paddingBottom: 10,
  },
  calendarWeekRow: {
    flexDirection: 'row',
    width: '100%',
    marginBottom: 8,
  },
  calendarWeekRowEmpty: {
    marginBottom: 2,
  },
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
  calendarCellCompact: {
    paddingVertical: 3,
    minHeight: 22,
  },
  calendarCellRowEmpty: {
    paddingVertical: 2,
    minHeight: 18,
  },
  calendarCellOut: {
    opacity: 0.42,
  },
  calendarCellHas: {
    backgroundColor: 'rgba(31, 42, 68, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(31, 42, 68, 0.45)',
  },
  calendarCellAgentDemo: {
    backgroundColor: `${GinitTheme.colors.primary}22`,
  },
  calendarCellPressed: {
    opacity: 0.9,
  },
  calendarCellDisabled: {
    opacity: 0.35,
  },
  calendarCellDay: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    lineHeight: 18,
  },
  calendarCellDayCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  calendarCellDayOut: {
    color: GinitTheme.colors.textMuted,
  },
  calendarTimesWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarCellMeta: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  calendarCellMetaCompact: {
    marginTop: 1,
    fontSize: 9,
  },
  calendarCellMetaEmpty: {
    marginTop: 2,
    fontSize: 10,
    color: 'transparent',
  },
  calendarCellMetaEmptyCompact: {
    marginTop: 1,
    fontSize: 9,
  },
  timePickHint: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
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
  /** 제목·주소 각 2줄 + 상세 정보 버튼까지 포함(이미지 112 + 여백) — `overflow: hidden` 호스트에 맞춤 */
  placeResultsCarouselHost: {
    height: 274,
  },
  placeResultsCarouselContent: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 10,
  },
  placeResultsLoadingMore: {
    width: 76,
    height: 274,
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: GinitTheme.fixedGlassCard.fill,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  placeResultImageCard: {
    width: 176,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  /** 가로 캐러셀(`placeResultsCarouselHost` 274) − 세로 패딩 20 기준 — 상세 정보 버튼을 카드 하단에 고정 */
  placeResultProposalCardWrap: {
    minHeight: 254,
    flexDirection: 'column',
  },
  placeResultProposalPressFill: {
    flex: 1,
    minHeight: 0,
  },
  placeResultProposalPressInner: {
    flexGrow: 1,
  },
  placeResultImageCardSelected: {
    borderColor: GinitTheme.colors.primary,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  placeResultImageWrap: {
    width: '100%',
    height: 112,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  placeResultImage: {
    width: '100%',
    height: '100%',
  },
  placeResultImageFallback: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
  },
  placeResultImageOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderRadius: 999,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  placeResultCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  placeResultTitle: {
    fontSize: 13,
    fontWeight: '600',
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
  placeResultDetailBtn: {
    marginTop: 8,
    flexShrink: 0,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: GinitTheme.radius.button,
    borderWidth: 1,
    borderColor: GinitTheme.colors.deepPurple,
    backgroundColor: GinitTheme.colors.deepPurple,
  },
  placeResultDetailBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  placePickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
    alignSelf: 'stretch',
  },
  placePickedName: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  placePickedRemove: {
    fontSize: 12,
    fontWeight: '600',
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
    fontWeight: '600',
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
    backgroundColor: 'rgba(31, 42, 68, 0.04)',
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
    fontWeight: '600',
    textAlign: 'center',
  },
  addCandidateBtnDisabled: {
    opacity: 0.45,
  },
  addCandidateBtnPressed: {
    opacity: 0.95,
    backgroundColor: 'rgba(31, 42, 68, 0.10)',
    borderColor: 'rgba(31, 42, 68, 0.45)',
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
    overflow: 'hidden',
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    // 모임 성격 타일: 플랫폼 공통으로 평면(무그림자) 유지
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  catTileActive: {
    borderColor: GinitTheme.colors.primary,
    backgroundColor: GinitTheme.colors.primarySoft,
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
  catLabelActive: {
    color: GinitTheme.colors.primary,
  },
  segmentRow: {
    flexDirection: 'row',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: '#FFFFFF',
  },
  segmentHalf: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  segmentHalfOn: {
    backgroundColor: 'rgba(31, 42, 68, 0.06)',
  },
  segmentHalfAgentCue: {
    opacity: 0.88,
  },
  segmentTitle: {
    fontSize: 13,
    fontWeight: '600',
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
    backgroundColor: 'rgba(244, 200, 74, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(244, 200, 74, 0.55)',
  },
  warnTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  warnBody: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
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
    fontWeight: '600',
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
  /** `placeResultsScrollHost`와 동일 — 공개 모임 상세(모집 연령대 등) 카드 외곽선 */
  wizardPublicMeetingDetailsCardOuter: {
    borderRadius: 16,
    padding: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    overflow: 'hidden',
  },
  wizardPublicMeetingDetailsWrapOverride: {
    marginBottom: 12,
    backgroundColor: 'transparent',
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  wizardFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
    marginBottom: 8,
    marginTop: 8,
    marginLeft: 8,
  },
  wizardFieldHint: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    marginBottom: 0,
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
    borderColor: 'rgba(31, 42, 68, 0.22)',
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
    fontWeight: '600',
  },
  wizardLockedHint: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    marginTop: 5,
    marginBottom: 5,
    lineHeight: 20,
  },
  wizardDoneHint: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(31, 42, 68, 0.85)',
    marginTop: 5,
    marginBottom: 4,
  },
  wizardFormMount: {
    marginTop: 4,
    marginBottom: 4,
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
    backgroundColor: 'rgba(31, 42, 68, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(31, 42, 68, 0.45)',
    shadowColor: 'rgba(31, 42, 68, 0.22)',
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
    fontWeight: '600',
    color: GinitTheme.colors.text,
    maxWidth: '100%',
  },
  finalRegistrationGlass: {
    paddingVertical: 6,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(31, 42, 68, 0.18)',
  },
  /** 상세 소개 입력과 하단 등록 CTA 사이 여백 */
  detailStepDescriptionCardOuter: {
    marginBottom: 16,
  },
  detailDescriptionInputShell: {
    position: 'relative',
  },
  detailDescriptionVoiceFab: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    zIndex: 2,
  },
  finalDescriptionInputWithVoiceFab: {
    paddingRight: 52,
    paddingBottom: 48,
  },
  finalDescriptionInput: {
    marginTop: 0,
    backgroundColor: GinitTheme.glassModal.inputFill,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  finalDescriptionInputFocused: {
    borderColor: GinitTheme.colors.primary,
  },
  detailFinalFloatingBtn: {
    position: 'absolute',
    left: 20,
    right: 20,
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
    fontWeight: '600',
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
