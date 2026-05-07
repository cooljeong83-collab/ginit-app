/**
 * 모임 등록 — `/create/details`: `currentStep >= n`으로 이전 단계 카드도 유지(한눈에 수정 가능).
 * 확인 버튼만 해당 단계 `currentStep === n`일 때 표시. 카테고리 변경 시 Step 1로 리셋·하위 카드 제거.
 * 일정 확정(`scheduleStep`) 후 `placesStep`에서 장소 후보 카드를 채운 뒤 상세·등록(`detailStep`)으로 이동.
 * 단계 번호: 4(일정)→5(장소)→6(상세). 영화도 동일(선행 장소 단계 없음 — 장소는 `placesStep` 한 번만).
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  InteractionManager,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ViewStyle
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
import {
  CreateMeetingAgenticSurfaceBinder,
  type MeetingCreateAgenticSurfaceHandles,
} from '@/components/create/CreateMeetingAgenticSurfaceBinder';
import { CreateMeetingNluComposerDock } from '@/components/create/CreateMeetingNluComposerDock';
import { CreateMeetingWizardAgentBridge } from '@/components/create/CreateMeetingWizardAgentBridge';
import { FocusKnowledgePreference } from '@/components/create/FocusKnowledgePreference';
import { GameKindPreference } from '@/components/create/GameKindPreference';
import {
  CAPACITY_UNLIMITED,
  GlassDualCapacityWheel,
  PARTICIPANT_COUNT_MIN,
} from '@/components/create/GlassDualCapacityWheel';
import {
  WIZARD_DETAIL_STEP,
  WIZARD_PLACES_STEP,
  WIZARD_SCHEDULE_STEP,
  type WizardStep,
} from '@/components/create/meeting-create-wizard-types';
import { MenuPreference } from '@/components/create/MenuPreference';
import { MovieSearch } from '@/components/create/MovieSearch';
import { PcGameKindPreference } from '@/components/create/PcGameKindPreference';
import { PublicMeetingDetailsCard } from '@/components/create/PublicMeetingDetailsCard';
import type {
  MeetingCreatePlacesAutoAssistSnapshot,
  VoteCandidatesFormHandle
} from '@/components/create/vote-candidates-form.types';
import { VoiceWaveform, VoteCandidateCard, VoteCandidatesForm } from '@/components/create/VoteCandidatesForm';
import { KeyboardAwareScreenScroll } from '@/components/ui';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { GinitTheme } from '@/constants/ginit-theme';
import { GinitStyles } from '@/constants/GinitStyles';
import { homeBlurIntensity, shouldUseStaticGlassInsteadOfBlur } from '@/constants/home-glass-styles';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useCreateMeetingAgentFabMeasure } from '@/src/hooks/use-create-meeting-agent-fab-measure';
import { useCreateMeetingNluSessionRefs } from '@/src/hooks/use-create-meeting-nlu-session-refs';
import type { WizardSuggestion } from '@/src/lib/agentic-guide/types';
import { layoutAnimateMeetingCreateWizard } from '@/src/lib/android-layout-animation';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
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
import { consumeCreateMeetingPlaceAutopilotError } from '@/src/lib/create-meeting-autopilot-place-result';
import {
  primaryScheduleFromDateCandidate
} from '@/src/lib/date-candidate';
import { deferSoftInputUntilUserTapProps } from '@/src/lib/defer-soft-input-until-user-tap';
import { toFiniteInt } from '@/src/lib/firestore-utils';
import { fetchDailyBoxOfficeTop10 } from '@/src/lib/kobis-daily-box-office';
import { buildMeetingCreateNluConfirmSummary } from '@/src/lib/meeting-create-agent-chat/confirm-summary';
import {
  isMeetingCreateNluPatchSemanticallyEmpty,
  MEETING_CREATE_AGENT_NLU_ERROR_RETRY_BUBBLE,
  pickBundledMeetingCreateNudge,
} from '@/src/lib/meeting-create-agent-chat/meeting-create-slots';
import { isMeetingCreateNluSummaryRejectionText } from '@/src/lib/meeting-create-agent-chat/nlu-confirm-intent';
import {
  appendMeetingCreateAgentChatMessage,
  createEmptyMeetingCreateAgentChatSession,
  fingerprintMeetingCreateParsedPlan,
  isLikelyMeetingCreateGreetingOnly,
  meetingCreateAgentChatSlidingHistoryForEdge,
  mergeMeetingCreateNluAccumulated,
} from '@/src/lib/meeting-create-agent-chat/session';
import {
  applyPartialPublicMeetingDetails,
  parseMeetingCreateNluPayload,
  peekMeetingCreateNluMissingSlots,
  wizardSuggestionFromNluPlan,
} from '@/src/lib/meeting-create-nlu';
import { invokeParseMeetingCreateIntent } from '@/src/lib/meeting-create-nlu-client';
import {
  appendMovieNudgeBoxOfficeRanks,
  buildDeferChoiceMeetingCreatePatch,
  isDeferUserChoiceUtterance,
  tryPatchMovieTitleFromBoxOfficeRankReply,
} from '@/src/lib/meeting-create-nlu/defer-user-choice';
import { inferMeetingCreateHeadcountFromKoreanText } from '@/src/lib/meeting-create-nlu/infer-headcount-from-korean-text';
import { mergeMeetingCreateNluAccumulatedWithAutoTitle } from '@/src/lib/meeting-create-nlu/inject-auto-title';
import {
  buildLocalMeetingCreateNluPatch,
  fillMeetingCreateNluPatchFromLocalEdge,
  mergeMeetingCreatePlacePatchWithAccumulated,
  shouldSkipEdgeNluForMeetingCreate,
} from '@/src/lib/meeting-create-nlu/local-intent-patch';
import { isMeetingCreateNaturalLanguageBlocked } from '@/src/lib/meeting-create-nlu/nlu-blocked-text';
import {
  deriveMeetingTitleFromOpeningUtterance,
  sanitizeMeetingCreateNluPatchForVenueFollowUp,
} from '@/src/lib/meeting-create-nlu/opening-utterance-meeting-title';
import { resolveMeetingCreateRules, type ResolvedMeetingCreateRules } from '@/src/lib/meeting-create-rules';
import { fmtDate, humanizeSpeechRecognitionError, pickParam } from '@/src/lib/meeting-create-vote-candidates-utils';
import { buildMeetingExtraData, type SelectedMovieExtra } from '@/src/lib/meeting-extra-data';
import type { VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import {
  consumePendingMeetingPlace
} from '@/src/lib/meeting-place-bridge';
import {
  generateAiMeetingDescription,
  generateSuggestedMeetingTitle,
  generateSuggestedMeetingTitles,
  getFinalDescriptionPlaceholder,
  type MeetingTitleSuggestionContext,
} from '@/src/lib/meeting-title-suggestion';
import { fetchTitleWeatherMood } from '@/src/lib/meeting-title-weather';
import { addMeeting, DEFAULT_PUBLIC_MEETING_DETAILS_CONFIG, normalizeProfileGenderToHostSnapshot, type PublicMeetingDetailsConfig } from '@/src/lib/meetings';
import { ensureNearbySearchBias, invalidateNearbySearchBiasCache } from '@/src/lib/nearby-search-bias';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import {
  getUserProfile,
  isMeetingServiceComplianceComplete,
  meetingDemographicsIncomplete,
  type UserProfile,
} from '@/src/lib/user-profile';

export type {
  MeetingCreatePlacesAutoAssistSnapshot,
  VoteCandidatesBuildResult, VoteCandidatesFormHandle, VoteCandidatesFormProps,
  VoteCandidatesGateResult
} from '@/components/create/vote-candidates-form.types';

/** 레거시 스펙 상수(점진 제거) — 시안 톤 토큰으로 치환 */
const INPUT_PLACEHOLDER = '#94a3b8';
/** 인라인 장소 검색: 표시·선택 상한 — `VoteCandidatesForm`과 동일 */
const INLINE_PLACE_PICK_MAX_SELECTED = 5;


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
  // avg 값이 비어있거나 비정상(예: undefined → NaN)인 경우가 있어 안전 폴백을 둡니다.
  const safeAvgMin = Number.isFinite(avgMin) ? avgMin : minFloor;
  const safeAvgMax = Number.isFinite(avgMax) ? avgMax : safeAvgMin;
  let nMin = Math.round(safeAvgMin);
  let nMax = Math.round(safeAvgMax);
  nMin = Math.min(capMax, Math.max(minFloor, nMin));
  nMax = Math.min(capMax, Math.max(nMin, nMax));
  return { min: nMin, max: nMax };
}

function waitAgentStep1FabUnlocked(isAlive?: () => boolean): Promise<void> {
  if (getAgentStep1InteractionUnlocked()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unsub();
      clearTimeout(tmax);
      clearInterval(poll);
      resolve();
    };
    const poll = setInterval(() => {
      if (isAlive && !isAlive()) finish();
    }, 80);
    const unsub = subscribeAgentStep1InteractionUnlocked(() => {
      if (getAgentStep1InteractionUnlocked()) finish();
    });
    const tmax = setTimeout(finish, 14000);
  });
}

export default function CreateDetailsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
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
  const onPlacesStepConfirmRef = useRef<() => void>(() => {});
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
  /** Provider 내부 `CreateMeetingAgenticSurfaceBinder`가 채우는 말풍선·수락 핸들 */
  const agenticSurfaceRef = useRef<MeetingCreateAgenticSurfaceHandles | null>(null);
  const {
    agentNluAccumulatedRef,
    pendingNluBoxOfficeTopThreeRef,
    agentNluSessionRef,
    agentNluLastFingerprintRef,
    meetingCreateNluOpeningUtteranceRef,
    pendingNluWizardApplyRef,
    pendingNluSummaryConfirmMsgRef,
    meetingCreateNluConfirmPhaseRef,
    meetingCreateNluBlocksFloatingFinal,
    setMeetingCreateNluConfirmPhase,
  } = useCreateMeetingNluSessionRefs();
  /** 하단 `지닛 시작하기` → 최종 등록 (정의 순서 때문에 ref로 최신 콜백 유지) */
  const onFinalRegisterRef = useRef<(opts?: { rethrowOnAddMeetingFailure?: boolean }) => Promise<void>>(
    async () => {},
  );
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
  const currentStepRef = useRef<WizardStep>(1);

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
  const [maxParticipants, setMaxParticipants] = useState(2);

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
  }, [isPublicMeeting]);

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
  const [voiceNluDraftRecognizing, setVoiceNluDraftRecognizing] = useState(false);
  /** 제목·상세·자연어 입력 음성이 같은 모듈 리스너를 쓰므로 결과 라우팅용 */
  const voiceCreateTargetRef = useRef<'title' | 'description' | 'nluDraft' | null>(null);

  useSpeechRecognitionEvent('start', () => {
    const k = voiceCreateTargetRef.current;
    if (k === 'title') setVoiceTitleRecognizing(true);
    if (k === 'description') setVoiceDescriptionRecognizing(true);
    if (k === 'nluDraft') setVoiceNluDraftRecognizing(true);
  });
  useSpeechRecognitionEvent('end', () => {
    const k = voiceCreateTargetRef.current;
    if (!k) return;
    setVoiceTitleRecognizing(false);
    setVoiceDescriptionRecognizing(false);
    setVoiceNluDraftRecognizing(false);
    voiceCreateTargetRef.current = null;
  });
  useSpeechRecognitionEvent('error', (event) => {
    const k = voiceCreateTargetRef.current;
    if (!k) return;
    setVoiceTitleRecognizing(false);
    setVoiceDescriptionRecognizing(false);
    setVoiceNluDraftRecognizing(false);
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
    if (k === 'nluDraft') setNaturalLanguageDraft(t);
    if (event?.isFinal) {
      setVoiceTitleRecognizing(false);
      setVoiceDescriptionRecognizing(false);
      setVoiceNluDraftRecognizing(false);
      voiceCreateTargetRef.current = null;
      ExpoSpeechRecognitionModule.stop();
    }
  });

  const onPressVoiceInputTitle = useCallback(async () => {
    if (voiceTitleRecognizing || voiceDescriptionRecognizing || voiceNluDraftRecognizing) {
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
  }, [voiceDescriptionRecognizing, voiceNluDraftRecognizing, voiceTitleRecognizing]);

  const onPressVoiceInputDescription = useCallback(async () => {
    if (voiceTitleRecognizing || voiceDescriptionRecognizing || voiceNluDraftRecognizing) {
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
  }, [voiceDescriptionRecognizing, voiceNluDraftRecognizing, voiceTitleRecognizing]);

  const onPressVoiceNaturalLanguageDraft = useCallback(async () => {
    if (voiceTitleRecognizing || voiceDescriptionRecognizing || voiceNluDraftRecognizing) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '음성 입력을 사용하려면 마이크/음성 인식 권한이 필요합니다.');
      return;
    }
    voiceCreateTargetRef.current = 'nluDraft';
    ExpoSpeechRecognitionModule.start({
      lang: 'ko-KR',
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
    });
  }, [voiceDescriptionRecognizing, voiceNluDraftRecognizing, voiceTitleRecognizing]);

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
  const [naturalLanguageDraft, setNaturalLanguageDraft] = useState('');
  const [nluBusy, setNluBusy] = useState(false);
  const [nluDockHeightPx, setNluDockHeightPx] = useState(152);
  /** 스텝1에서 사용자가 확인을 눌러 NLU 도크를 페이드아웃으로 숨긴 뒤 — 카테고리 단계 초기화 시 해제 */
  const [nluComposerUserDismissed, setNluComposerUserDismissed] = useState(false);
  const nluComposerDismissOpacity = useRef(new Animated.Value(1)).current;
  const [nluKeyboardDimActive, setNluKeyboardDimActive] = useState(false);
  const nluDimOpacity = useRef(new Animated.Value(0)).current;
  const [nluDimLayerMounted, setNluDimLayerMounted] = useState(false);
  const [autopilotCoachLocked, setAutopilotCoachLocked] = useState(false);
  /** NLU 자동 적용이 장소 검색어를 넣은 뒤 — 확인 버튼 게이트·3초 미선택 시 수동 전환에만 사용 */
  const [placesAiAssistGate, setPlacesAiAssistGate] = useState(false);
  const [placeAutoSnap, setPlaceAutoSnap] = useState<MeetingCreatePlacesAutoAssistSnapshot>({
    searchLoading: false,
    searchError: null,
    resultCount: 0,
    hasFilledPlace: false,
    queryTrim: '',
    anyPlaceResolving: false,
    lastSettledQueryTrim: null,
  });
  const placeAutoSnapRef = useRef(placeAutoSnap);
  placeAutoSnapRef.current = placeAutoSnap;
  const placesAiAssistGateRef = useRef(placesAiAssistGate);
  placesAiAssistGateRef.current = placesAiAssistGate;
  const onPlacesAutoAssistSnapshot = useCallback((s: MeetingCreatePlacesAutoAssistSnapshot) => {
    setPlaceAutoSnap(s);
  }, []);
  const [agentWizardApplyCue, setAgentWizardApplyCue] = useState<AgentWizardApplyCue | null>(null);
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  currentStepRef.current = currentStep;
  isPublicMeetingRef.current = isPublicMeeting;

  const {
    programmaticScrollPendingRef,
    scrollSettleMeasureTimerRef,
    scrollDismissLastNotifyMsRef,
    scheduleAgentFabMeasureRef,
    armAgentFabScrollSettleMeasureRef,
    predictAgentFabWindowRectBeforeVerticalScrollRef,
    agentStepShellRefs,
    agentFabWindowRect,
    onAgentFabMainScrollSettled,
    onWizardStepShellLayout,
    captureStepPosition,
  } = useCreateMeetingAgentFabMeasure({
    currentStepRef,
    mainScrollYRef,
    currentStep,
    stepPositions,
  });

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
  const scheduleStep = WIZARD_SCHEDULE_STEP;
  const placesStep = WIZARD_PLACES_STEP;
  const detailStep = WIZARD_DETAIL_STEP;

  const placesConfirmDisabledByAiAssist = useMemo(() => {
    if (!placesAiAssistGate || currentStep !== placesStep) return false;
    const s = placeAutoSnap;
    return (
      s.searchLoading ||
      s.queryTrim.length === 0 ||
      !s.hasFilledPlace ||
      s.anyPlaceResolving ||
      (s.queryTrim.length > 0 && s.lastSettledQueryTrim !== s.queryTrim)
    );
  }, [placesAiAssistGate, currentStep, placesStep, placeAutoSnap]);

  const resetWizardState = useCallback(() => {
    setTitle('');
    setMinParticipants(PARTICIPANT_COUNT_MIN);
    setMaxParticipants(2);
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
              nluComposerDismissOpacity.setValue(1);
              setNluComposerUserDismissed(false);
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

  const screenTitle = useMemo(() => {
    const region = titleRegion?.trim() ?? '';
    const cat = selectedCategory?.label?.trim() ?? paramCategoryLabel.trim();
    const head = [region, cat].filter((s) => s.length > 0).join(' ');
    return head.length > 0 ? `${head} 모임 생성` : '모임 생성';
  }, [titleRegion, selectedCategory?.label, paramCategoryLabel]);

  const nluDockReservePx = useMemo(
    () => (!snsDemographicsBlocked && !nluComposerUserDismissed ? nluDockHeightPx : 0),
    [snsDemographicsBlocked, nluComposerUserDismissed, nluDockHeightPx],
  );

  /** 붉은 경고: NLU 도크가 있으면 도크 높이만큼, 없으면 하단 safe area(OS 내비·홈 인디케이터 등)만큼 위로 */
  const wizardFloatingErrorBottomPx = useMemo(() => {
    const pad = 24;
    const docked = !snsDemographicsBlocked && !nluComposerUserDismissed;
    if (docked) return pad + nluDockReservePx;
    return pad + insets.bottom;
  }, [snsDemographicsBlocked, nluComposerUserDismissed, nluDockReservePx, insets.bottom]);

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

  // 비공개도 공개와 동일하게 최소/최대 인원을 사용합니다.

  const onStep1Next = useCallback((opts?: { fromUserPress?: boolean }) => {
    setWizardError(null);
    if (!selectedCategoryId || !selectedCategory) {
      setWizardError('카테고리를 선택해 주세요.');
      return;
    }
    if (opts?.fromUserPress) {
      nluComposerDismissOpacity.stopAnimation();
      Animated.timing(nluComposerDismissOpacity, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setNluComposerUserDismissed(true);
      });
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
  }, [needsSpecialty, selectedCategory, selectedCategoryId, nluComposerDismissOpacity]);

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

  /** 자동 모임 생성(오토 적용·장소 오토) 중 오류 시 즉시 수동 모드로 전환하고 NLU 블러·말풍선·하단 채팅 도크를 걷습니다. */
  const dismissNluAutoChromeForManualRecovery = useCallback(() => {
    Keyboard.dismiss();
    setNluKeyboardDimActive(false);
    nluDimOpacity.stopAnimation();
    nluDimOpacity.setValue(0);
    setNluDimLayerMounted(false);
    notifyCreateMeetingAgentBubbleDismissFromManualScroll();
    const surf = agenticSurfaceRef.current;
    surf?.setAgentOwnsWizardBubble(false);
    surf?.setIntelligentSuggestionDirect(null);
    surf?.setShowAcceptButton(false);
    surf?.registerAcceptSuggestion(null);
    nluComposerDismissOpacity.stopAnimation();
    nluComposerDismissOpacity.setValue(0);
    setNluComposerUserDismissed(true);
    setAgentFabMotionMode('user');
  }, [nluComposerDismissOpacity, nluDimOpacity]);

  /** 생성 화면 이탈(blur·스택에서 제거) 시 자동 생성·NLU 수락 루프를 끊고 수동 모드로 복귀 */
  const abortMeetingCreateWizardOnScreenLeave = useCallback(() => {
    agentWizardApplyRunIdRef.current += 1;
    setAgentFabMotionMode('user');
    setAutopilotCoachLocked(false);
    setAgentWizardApplyCue(null);
    setPlacesAiAssistGate(false);
    setNluBusy(false);
    agentNluAccumulatedRef.current = {};
    meetingCreateNluOpeningUtteranceRef.current = '';
    pendingNluBoxOfficeTopThreeRef.current = null;
    agentNluSessionRef.current = createEmptyMeetingCreateAgentChatSession();
    agentNluLastFingerprintRef.current = null;
    pendingNluWizardApplyRef.current = null;
    pendingNluSummaryConfirmMsgRef.current = '';
    setMeetingCreateNluConfirmPhase('none');
    const surf = agenticSurfaceRef.current;
    surf?.setAgentOwnsWizardBubble(false);
    surf?.setIntelligentSuggestionDirect(null);
    surf?.setShowAcceptButton(false);
    surf?.registerAcceptSuggestion(null);
    dismissNluAutoChromeForManualRecovery();
    setNluComposerUserDismissed(false);
    nluComposerDismissOpacity.setValue(1);
  }, [dismissNluAutoChromeForManualRecovery, nluComposerDismissOpacity, setMeetingCreateNluConfirmPhase]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        abortMeetingCreateWizardOnScreenLeave();
      };
    }, [abortMeetingCreateWizardOnScreenLeave]),
  );

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => {
      abortMeetingCreateWizardOnScreenLeave();
    });
    return () => unsub();
  }, [abortMeetingCreateWizardOnScreenLeave, navigation]);

  useFocusEffect(
    useCallback(() => {
      const msg = consumeCreateMeetingPlaceAutopilotError();
      if (!msg) return;
      setPlacesAiAssistGate(false);
      dismissNluAutoChromeForManualRecovery();
      showTransientBottomMessage(msg);
    }, [dismissNluAutoChromeForManualRecovery]),
  );

  const applyWizardSuggestion = useCallback(
    (sugg: WizardSuggestion): Promise<void> => {
      setAgentFabMotionMode('auto');
      layoutAnimateMeetingCreateWizard();

      return (async () => {
        const runId = ++agentWizardApplyRunIdRef.current;
        const isApplyRunAlive = () => runId === agentWizardApplyRunIdRef.current;
        const tapHoldMs = AGENT_APPLY_TAP_HOLD_MS;
        const stepGapMs = AGENT_APPLY_STEP_GAP_MS;
        setAutopilotCoachLocked(true);

        const stopAutopilotToManual = (userMsg: string) => {
          agentWizardApplyRunIdRef.current += 1;
          setWizardError(userMsg);
          showTransientBottomMessage(userMsg);
          setAgentWizardApplyCue(null);
          dismissNluAutoChromeForManualRecovery();
        };

        const waitUntilWizardStepEquals = async (expected: WizardStep): Promise<boolean> => {
          const deadline = Date.now() + 4000;
          while (Date.now() < deadline) {
            if (!isApplyRunAlive()) return false;
            if (currentStepRef.current === expected) return true;
            await sleep(24);
          }
          return currentStepRef.current === expected;
        };

        const assertStepAfterOrStop = async (expected: WizardStep, errMsg: string): Promise<boolean> => {
          if (!isApplyRunAlive()) return false;
          const ok = await waitUntilWizardStepEquals(expected);
          if (ok) return true;
          if (!isApplyRunAlive()) return false;
          stopAutopilotToManual(errMsg);
          return false;
        };

        try {
          if (currentStepRef.current !== 1) {
            stopAutopilotToManual('모임 만들기가 1단계가 아니어 자동 입력을 중단했습니다. 수동으로 이어가 주세요.');
            return;
          }

          await waitAgentStep1FabUnlocked(isApplyRunAlive);
          if (!isApplyRunAlive()) return;
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

          const needsSpecAfter = catForSk ? categoryNeedsSpecialty(catForSk) : false;
          suppressStepLayoutAnimateFromCategoryRef.current = true;
          onStep1NextRef.current();
          const expectedAfterStep1Confirm: WizardStep = needsSpecAfter ? 2 : 3;
          if (
            !(await assertStepAfterOrStop(
              expectedAfterStep1Confirm,
              '1단계 확인 후 다음 단계로 넘어가지 못했습니다. 카테고리·공개 설정을 확인한 뒤 수동으로 진행해 주세요.',
            ))
          ) {
            return;
          }

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
            if (
              !(await assertStepAfterOrStop(
                3,
                '특화 단계 확인 후 기본 정보 단계로 넘어가지 못했습니다. 수동으로 진행해 주세요.',
              ))
            ) {
              return;
            }
            reachedBasicStep = true;
          } else if (sugg.canAutoCompleteThroughStep3 && sk === 'movie' && (sugg.movieTitleHints?.length ?? 0) > 0) {
            await new Promise<void>((r) => {
              InteractionManager.runAfterInteractions(() => r());
            });
            await sleep(AGENT_APPLY_POST_LAYOUT_MS);
            const titles = (sugg.movieTitleHints ?? []).map((t) => String(t).trim()).filter(Boolean);
            setMovieCandidates(titles.map((title, i) => ({ id: `nlu-m${i}`, title })));
            await sleep(stepGapMs);
            setAgentWizardApplyCue({ kind: 'confirm2' });
            await sleep(tapHoldMs);
            setAgentWizardApplyCue(null);
            await sleep(stepGapMs);
            onStep2SpecialtyNextRef.current();
            if (
              !(await assertStepAfterOrStop(
                3,
                '특화 단계 확인 후 기본 정보 단계로 넘어가지 못했습니다. 수동으로 진행해 주세요.',
              ))
            ) {
              return;
            }
            reachedBasicStep = true;
          } else if (
            sugg.canAutoCompleteThroughStep3 &&
            sk === 'sports' &&
            isActiveLifeMajorCode(catForSk?.majorCode) &&
            sugg.activityKindLabel
          ) {
            await new Promise<void>((r) => {
              InteractionManager.runAfterInteractions(() => r());
            });
            await sleep(AGENT_APPLY_POST_LAYOUT_MS);
            setActivityKinds([sugg.activityKindLabel]);
            await sleep(stepGapMs);
            setAgentWizardApplyCue({ kind: 'confirm2' });
            await sleep(tapHoldMs);
            setAgentWizardApplyCue(null);
            await sleep(stepGapMs);
            onStep2SpecialtyNextRef.current();
            if (
              !(await assertStepAfterOrStop(
                3,
                '특화 단계 확인 후 기본 정보 단계로 넘어가지 못했습니다. 수동으로 진행해 주세요.',
              ))
            ) {
              return;
            }
            reachedBasicStep = true;
          } else if (
            sugg.canAutoCompleteThroughStep3 &&
            sk === 'sports' &&
            isPlayAndVibeMajorCode(catForSk?.majorCode) &&
            sugg.gameKindLabel
          ) {
            await new Promise<void>((r) => {
              InteractionManager.runAfterInteractions(() => r());
            });
            await sleep(AGENT_APPLY_POST_LAYOUT_MS);
            setGameKinds([sugg.gameKindLabel]);
            await sleep(stepGapMs);
            setAgentWizardApplyCue({ kind: 'confirm2' });
            await sleep(tapHoldMs);
            setAgentWizardApplyCue(null);
            await sleep(stepGapMs);
            onStep2SpecialtyNextRef.current();
            if (
              !(await assertStepAfterOrStop(
                3,
                '특화 단계 확인 후 기본 정보 단계로 넘어가지 못했습니다. 수동으로 진행해 주세요.',
              ))
            ) {
              return;
            }
            reachedBasicStep = true;
          } else if (
            sugg.canAutoCompleteThroughStep3 &&
            sk === 'sports' &&
            isPcGameMajorCode(catForSk?.majorCode) &&
            sugg.pcGameKindLabel
          ) {
            await new Promise<void>((r) => {
              InteractionManager.runAfterInteractions(() => r());
            });
            await sleep(AGENT_APPLY_POST_LAYOUT_MS);
            setGameKinds([sugg.pcGameKindLabel]);
            await sleep(stepGapMs);
            setAgentWizardApplyCue({ kind: 'confirm2' });
            await sleep(tapHoldMs);
            setAgentWizardApplyCue(null);
            await sleep(stepGapMs);
            onStep2SpecialtyNextRef.current();
            if (
              !(await assertStepAfterOrStop(
                3,
                '특화 단계 확인 후 기본 정보 단계로 넘어가지 못했습니다. 수동으로 진행해 주세요.',
              ))
            ) {
              return;
            }
            reachedBasicStep = true;
          } else if (sugg.canAutoCompleteThroughStep3 && sk === 'knowledge' && sugg.focusKnowledgeLabel) {
            await new Promise<void>((r) => {
              InteractionManager.runAfterInteractions(() => r());
            });
            await sleep(AGENT_APPLY_POST_LAYOUT_MS);
            setFocusKnowledgePreferences([sugg.focusKnowledgeLabel]);
            await sleep(stepGapMs);
            setAgentWizardApplyCue({ kind: 'confirm2' });
            await sleep(tapHoldMs);
            setAgentWizardApplyCue(null);
            await sleep(stepGapMs);
            onStep2SpecialtyNextRef.current();
            if (
              !(await assertStepAfterOrStop(
                3,
                '특화 단계 확인 후 기본 정보 단계로 넘어가지 못했습니다. 수동으로 진행해 주세요.',
              ))
            ) {
              return;
            }
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
          if (
            !(await assertStepAfterOrStop(
              scheduleStep,
              '기본 정보 확인 후 일정 단계로 넘어가지 못했습니다. 수동으로 진행해 주세요.',
            ))
          ) {
            return;
          }

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
          if (!isApplyRunAlive()) return;
          if (
            !(await assertStepAfterOrStop(
              placesStep,
              '일정 확정 후 장소 단계로 넘어가지 못했습니다. 수동으로 진행해 주세요.',
            ))
          ) {
            return;
          }

          const placeQ = (sugg.placeAutoPickQuery ?? sugg.placeSearchHint ?? '').trim();
          if (placeQ) {
            setPlacesAiAssistGate(true);
            placesFormRef.current?.setPlaceQueryFromAgent(placeQ);
            showTransientBottomMessage(
              '검색이 끝나면 상위 결과를 자동으로 담은 뒤 확인을 눌러 다음 단계로 이동합니다.',
            );
            await sleep(stepGapMs);
            const qExpect = placeQ;
            const settleSearchDeadline = Date.now() + 24000;
            while (Date.now() < settleSearchDeadline) {
              if (!isApplyRunAlive()) return;
              const snap = placeAutoSnapRef.current;
              if (
                !snap.searchLoading &&
                snap.queryTrim === qExpect &&
                snap.lastSettledQueryTrim === qExpect
              ) {
                break;
              }
              await sleep(40);
            }
            if (!isApplyRunAlive()) return;
            const snap0 = placeAutoSnapRef.current;
            if (
              snap0.searchLoading ||
              snap0.queryTrim !== qExpect ||
              snap0.lastSettledQueryTrim !== qExpect
            ) {
              setPlacesAiAssistGate(false);
              stopAutopilotToManual(
                '장소 검색 결과를 불러오지 못했습니다. 검색어를 바꿔 수동으로 진행해 주세요.',
              );
              return;
            }
            if (snap0.searchError) {
              setPlacesAiAssistGate(false);
              stopAutopilotToManual(snap0.searchError);
              return;
            }
            if (snap0.resultCount === 0) {
              setPlacesAiAssistGate(false);
              stopAutopilotToManual('검색 결과가 없어요. 장소를 수동으로 검색·선택해 주세요.');
              return;
            }
            const maxPick = Math.min(INLINE_PLACE_PICK_MAX_SELECTED, Math.max(1, snap0.resultCount));
            let placesReady: VoteCandidatesFormHandle | null = null;
            for (let i = 0; i < 60; i += 1) {
              placesReady = placesFormRef.current;
              if (placesReady?.playAgentPlaceInlinePick) break;
              await sleep(55);
              if (!isApplyRunAlive()) return;
            }
            if (!placesReady?.playAgentPlaceInlinePick) {
              setPlacesAiAssistGate(false);
              stopAutopilotToManual('장소 자동 선택을 시작하지 못했습니다. 수동으로 진행해 주세요.');
              return;
            }
            const pickRes = await placesReady.playAgentPlaceInlinePick({
              maxPicks: maxPick,
              isAlive: isApplyRunAlive,
            });
            if (!isApplyRunAlive()) return;
            if (pickRes === 'aborted') return;
            if (pickRes === 'empty' || pickRes === 'error') {
              setPlacesAiAssistGate(false);
              stopAutopilotToManual(
                pickRes === 'empty'
                  ? '검색 결과가 없어요. 장소를 수동으로 검색·선택해 주세요.'
                  : '장소 좌표를 가져오지 못했습니다. 수동으로 선택해 주세요.',
              );
              return;
            }
            const coordsSettleDeadline = Date.now() + 60000;
            while (Date.now() < coordsSettleDeadline) {
              if (!isApplyRunAlive()) return;
              const sn = placeAutoSnapRef.current;
              if (!sn.anyPlaceResolving && sn.hasFilledPlace) break;
              await sleep(48);
            }
            if (!isApplyRunAlive()) return;
            if (!placeAutoSnapRef.current.hasFilledPlace) {
              setPlacesAiAssistGate(false);
              stopAutopilotToManual('장소 후보를 채우지 못했습니다. 수동으로 선택해 주세요.');
              return;
            }
            await sleep(stepGapMs);
            onPlacesStepConfirmRef.current();
            if (
              !(await assertStepAfterOrStop(
                detailStep,
                '장소 확인 후 상세 단계로 넘어가지 못했습니다. 수동으로 진행해 주세요.',
              ))
            ) {
              return;
            }
          }

          if (!isApplyRunAlive()) return;
          if (isPublicMeetingRef.current && sugg.publicMeetingDetailsPartial) {
            setMeetingConfig((prev) => applyPartialPublicMeetingDetails(prev, sugg.publicMeetingDetailsPartial!));
          }
        } catch {
          setPlacesAiAssistGate(false);
          stopAutopilotToManual('자동 입력 중 문제가 생겼습니다. 수동으로 진행해 주세요.');
        } finally {
          setPlacesAiAssistGate(false);
          /** NLU 수락 후 자동 진행이 끝나면 말풍선 소유를 풀어 `CreateMeetingWizardAgentBridge`가 현재 단계 코치 문구를 넣게 함(초기 인사 톤 방지). */
          agenticSurfaceRef.current?.setAgentOwnsWizardBubble(false);
          setAutopilotCoachLocked(false);
          setAgentFabMotionMode('user');
        }
      })();
    },
    [categories, dismissNluAutoChromeForManualRecovery],
  );

  const applyWizardSuggestionRef = useRef(applyWizardSuggestion);
  applyWizardSuggestionRef.current = applyWizardSuggestion;

  const onPressAnalyzeNaturalLanguage = useCallback(async () => {
    const raw = naturalLanguageDraft.trim();
    if (!raw) {
      Alert.alert('입력', '모임 내용을 입력하거나 음성으로 말해 주세요.');
      return;
    }
    if (catLoading || categories.length === 0) {
      Alert.alert('잠시만요', '카테고리를 불러오는 중입니다.');
      return;
    }
    const blockedLocal = isMeetingCreateNaturalLanguageBlocked(raw);
    if (blockedLocal.blocked) {
      Alert.alert('모임 생성', blockedLocal.message);
      return;
    }
    /** 하단 채팅 전송 시 말풍선이 접혀 있으면 자동으로 펼쳐 대화가 이어지게 함 */
    notifyCreateMeetingAgentBubbleShow();
    const surf = agenticSurfaceRef.current;
    const now = new Date();
    setNluBusy(true);
    setNaturalLanguageDraft('');
    setWizardError(null);
    surf?.setShowAcceptButton(false);
    surf?.registerAcceptSuggestion(null);
    try {
      const todayYmd = fmtDate(now);
      pendingNluWizardApplyRef.current = null;
      const phaseAtStart = meetingCreateNluConfirmPhaseRef.current;

      if (phaseAtStart === 'summary' && isMeetingCreateNluSummaryRejectionText(raw)) {
        setMeetingCreateNluConfirmPhase('which_part');
        agentNluSessionRef.current = appendMeetingCreateAgentChatMessage(agentNluSessionRef.current, 'user', raw);
        const amendMsg =
          '어떤 부분을 수정해 드릴까요?\n\n일정·장소·인원·공개 여부 등 바꾸고 싶은 점을 말씀해 주세요.';
        agentNluSessionRef.current = appendMeetingCreateAgentChatMessage(
          agentNluSessionRef.current,
          'assistant',
          amendMsg,
        );
        surf?.setAgentOwnsWizardBubble(true);
        surf?.setIntelligentSuggestionDirect(amendMsg);
        surf?.setShowAcceptButton(false);
        surf?.registerAcceptSuggestion(null);
        return;
      }

      const priorUserTurns = agentNluSessionRef.current.messages.filter((m) => m.role === 'user').length;
      const beforeAcc = { ...agentNluAccumulatedRef.current };
      const missBefore = peekMeetingCreateNluMissingSlots(categories, beforeAcc, now).length;
      const fullMissCount = peekMeetingCreateNluMissingSlots(categories, {}, now).length;
      const hadPartialAccum = missBefore < fullMissCount;

      if (phaseAtStart === 'none' && isLikelyMeetingCreateGreetingOnly(raw) && priorUserTurns === 0) {
        agentNluSessionRef.current = appendMeetingCreateAgentChatMessage(agentNluSessionRef.current, 'user', raw);
        const greetReply = pickBundledMeetingCreateNudge([], { emptyTurn: true, hadPartialAccum: false });
        agentNluSessionRef.current = appendMeetingCreateAgentChatMessage(
          agentNluSessionRef.current,
          'assistant',
          greetReply,
        );
        surf?.setAgentOwnsWizardBubble(true);
        surf?.setIntelligentSuggestionDirect(greetReply);
        return;
      }

      const wasFirstSubstantiveNluTurn = priorUserTurns === 0;
      agentNluSessionRef.current = appendMeetingCreateAgentChatMessage(agentNluSessionRef.current, 'user', raw);
      if (wasFirstSubstantiveNluTurn) {
        meetingCreateNluOpeningUtteranceRef.current = raw.trim();
      }
      surf?.setAgentOwnsWizardBubble(true);
      surf?.setIntelligentSuggestionDirect('생각 중…');

      const localPatch = buildLocalMeetingCreateNluPatch({
        text: raw,
        categories,
        now,
        accumulated: beforeAcc,
      });
      const inv = shouldSkipEdgeNluForMeetingCreate(raw, localPatch)
        ? ({ ok: true as const, result: localPatch })
        : await invokeParseMeetingCreateIntent({
            text: raw,
            todayYmd,
            accumulated: Object.keys(beforeAcc).length > 0 ? beforeAcc : undefined,
            history: meetingCreateAgentChatSlidingHistoryForEdge(agentNluSessionRef.current, 3),
          });
      if (!inv.ok) {
        setMeetingCreateNluConfirmPhase('none');
        agentNluSessionRef.current = appendMeetingCreateAgentChatMessage(
          agentNluSessionRef.current,
          'assistant',
          MEETING_CREATE_AGENT_NLU_ERROR_RETRY_BUBBLE,
        );
        surf?.setIntelligentSuggestionDirect(MEETING_CREATE_AGENT_NLU_ERROR_RETRY_BUBBLE);
        if ('blocked' in inv && inv.blocked) {
          Alert.alert('모임 생성', inv.error);
        } else {
          setWizardError(inv.error);
          showTransientBottomMessage(inv.error);
        }
        return;
      }

      let patch =
        typeof inv.result === 'object' && inv.result !== null && !Array.isArray(inv.result)
          ? (inv.result as Record<string, unknown>)
          : {};
      patch = fillMeetingCreateNluPatchFromLocalEdge(patch, localPatch);
      patch = mergeMeetingCreatePlacePatchWithAccumulated(beforeAcc, patch);
      patch = sanitizeMeetingCreateNluPatchForVenueFollowUp(patch, {
        categories,
        beforeAcc,
        raw,
        now,
        priorUserTurns,
      });
      const openingUtteranceTitleFallback = deriveMeetingTitleFromOpeningUtterance(
        meetingCreateNluOpeningUtteranceRef.current,
      );
      const inferredHc = inferMeetingCreateHeadcountFromKoreanText(raw);
      if (inferredHc) {
        const patchMaxDirect =
          typeof (patch as { maxParticipants?: unknown }).maxParticipants === 'number' &&
          Number.isFinite((patch as { maxParticipants?: number }).maxParticipants)
            ? Math.trunc((patch as { maxParticipants: number }).maxParticipants)
            : NaN;
        const patchCrew = (patch as Record<string, unknown>)['인원'];
        const patchMaxNested =
          patchCrew && typeof patchCrew === 'object' && !Array.isArray(patchCrew) && typeof (patchCrew as Record<string, unknown>)['최대'] === 'number'
            ? Math.trunc((patchCrew as Record<string, unknown>)['최대'] as number)
            : NaN;
        const patchMaxMissing = !Number.isFinite(patchMaxDirect) && !Number.isFinite(patchMaxNested);
        const tmpMerge = mergeMeetingCreateNluAccumulated(beforeAcc, patch);
        if (patchMaxMissing || peekMeetingCreateNluMissingSlots(categories, tmpMerge, now).includes('headcount')) {
          patch = { ...patch, ...inferredHc };
        }
      }
      const mergedBase = mergeMeetingCreateNluAccumulated(beforeAcc, patch);
      let merged = mergeMeetingCreateNluAccumulatedWithAutoTitle({
        accumulated: mergedBase,
        now,
        manualTitle: title,
        openingUtteranceTitleFallback,
        aiTitleSuggestionFirst: (aiTitleSuggestions[0] ?? '').trim(),
        categoryLabelForTitle: (selectedCategory?.label?.trim() ?? paramCategoryLabel.trim()) || '모임',
        titleSuggestionCtx,
      });

      let rankMerged = false;
      const missForRankPeek = peekMeetingCreateNluMissingSlots(categories, merged, now);
      if (missForRankPeek.includes('moviePick')) {
        const rankPatch = tryPatchMovieTitleFromBoxOfficeRankReply(
          raw,
          pendingNluBoxOfficeTopThreeRef.current,
          missForRankPeek,
        );
        if (rankPatch) {
          merged = mergeMeetingCreateNluAccumulated(merged, rankPatch);
          merged = mergeMeetingCreateNluAccumulatedWithAutoTitle({
            accumulated: merged,
            now,
            manualTitle: title,
            openingUtteranceTitleFallback,
            aiTitleSuggestionFirst: (aiTitleSuggestions[0] ?? '').trim(),
            categoryLabelForTitle: (selectedCategory?.label?.trim() ?? paramCategoryLabel.trim()) || '모임',
            titleSuggestionCtx,
          });
          rankMerged = true;
          pendingNluBoxOfficeTopThreeRef.current = null;
        }
      }

      let missingSlots = peekMeetingCreateNluMissingSlots(categories, merged, now);
      const nudgeCatId = typeof merged.categoryId === 'string' ? merged.categoryId.trim() : '';
      const nudgeCat = nudgeCatId ? categories.find((c) => c.id.trim() === nudgeCatId) ?? null : null;

      let kobisForMovieNudge: Awaited<ReturnType<typeof fetchDailyBoxOfficeTop10>> | null = null;
      let deferMerged = false;
      if (isDeferUserChoiceUtterance(raw)) {
        const deferPatch = buildDeferChoiceMeetingCreatePatch({
          raw,
          missingSlots,
          categoryId: nudgeCatId,
        });
        let extraDefer: Record<string, unknown> = { ...deferPatch };
        if (missingSlots.includes('moviePick') && resolveSpecialtyKindForCategory(nudgeCat) === 'movie') {
          kobisForMovieNudge = await fetchDailyBoxOfficeTop10();
          if (kobisForMovieNudge.ok && kobisForMovieNudge.movies[0]?.title?.trim()) {
            const t0 = kobisForMovieNudge.movies[0].title.trim();
            extraDefer = { ...extraDefer, primaryMovieTitle: t0, movieTitleHints: [t0] };
          }
        }
        if (Object.keys(extraDefer).length > 0) {
          merged = mergeMeetingCreateNluAccumulated(merged, extraDefer);
          merged = mergeMeetingCreateNluAccumulatedWithAutoTitle({
            accumulated: merged,
            now,
            manualTitle: title,
            openingUtteranceTitleFallback,
            aiTitleSuggestionFirst: (aiTitleSuggestions[0] ?? '').trim(),
            categoryLabelForTitle: (selectedCategory?.label?.trim() ?? paramCategoryLabel.trim()) || '모임',
            titleSuggestionCtx,
          });
          deferMerged = true;
          missingSlots = peekMeetingCreateNluMissingSlots(categories, merged, now);
        }
      }

      if (!peekMeetingCreateNluMissingSlots(categories, merged, now).includes('moviePick')) {
        pendingNluBoxOfficeTopThreeRef.current = null;
      }

      agentNluAccumulatedRef.current = merged;

      const missAfter = peekMeetingCreateNluMissingSlots(categories, merged, now).length;
      const meaningful =
        missAfter < missBefore ||
        !isMeetingCreateNluPatchSemanticallyEmpty(patch) ||
        deferMerged ||
        rankMerged;
      missingSlots = peekMeetingCreateNluMissingSlots(categories, merged, now);

      if (missingSlots.length > 0) {
        setMeetingCreateNluConfirmPhase('none');
        const emptyTurn =
          !meaningful &&
          isMeetingCreateNluPatchSemanticallyEmpty(patch) &&
          isLikelyMeetingCreateGreetingOnly(raw);
        const placeHintQ = String(
          merged.placeAutoPickQuery ?? (merged as Record<string, unknown>)['장소'] ?? '',
        ).trim();
        const areaOnlyHint = missingSlots.includes('placeVenue') && placeHintQ ? placeHintQ : undefined;
        const baseNudge = pickBundledMeetingCreateNudge(missingSlots, {
          emptyTurn,
          hadPartialAccum: hadPartialAccum && meaningful,
          resolvedCategory: nudgeCat,
          areaOnlyHint,
        });
        let nudge = baseNudge;
        if (typeof merged.nluAskMessage === 'string' && merged.nluAskMessage.trim()) {
          const a = merged.nluAskMessage.trim();
          const placeVenueOnly =
            missingSlots.length === 1 && missingSlots[0] === 'placeVenue';
          nudge =
            placeVenueOnly && baseNudge
              ? baseNudge
              : baseNudge && a !== baseNudge
                ? `${a}\n\n${baseNudge}`
                : a;
        }
        if (missingSlots.includes('moviePick')) {
          const kobis = kobisForMovieNudge ?? (await fetchDailyBoxOfficeTop10());
          kobisForMovieNudge = kobis;
          if (kobis.ok && kobis.movies.length >= 3) {
            nudge = appendMovieNudgeBoxOfficeRanks(baseNudge, kobis.movies);
            const picks = kobis.movies
              .slice(0, 3)
              .map((m) => ({ title: String(m.title ?? '').trim() }))
              .filter((x) => x.title.length > 0);
            pendingNluBoxOfficeTopThreeRef.current = picks.length >= 3 ? picks : null;
          } else {
            pendingNluBoxOfficeTopThreeRef.current = null;
          }
        }
        agentNluSessionRef.current = appendMeetingCreateAgentChatMessage(
          agentNluSessionRef.current,
          'assistant',
          nudge,
        );
        surf?.setIntelligentSuggestionDirect(nudge);
        return;
      }

      const parsed = parseMeetingCreateNluPayload(categories, merged, now);
      if (!parsed.ok) {
        setMeetingCreateNluConfirmPhase('none');
        const missParsed = peekMeetingCreateNluMissingSlots(categories, merged, now);
        const placeHintErr = String(
          merged.placeAutoPickQuery ?? (merged as Record<string, unknown>)['장소'] ?? '',
        ).trim();
        const areaOnlyHintErr =
          missParsed.includes('placeVenue') && placeHintErr ? placeHintErr : undefined;
        const baseNudgeErr = pickBundledMeetingCreateNudge(missParsed, {
          emptyTurn: false,
          hadPartialAccum,
          resolvedCategory: nudgeCat,
          areaOnlyHint: areaOnlyHintErr,
        });
        let nudgeErr = baseNudgeErr;
        if (typeof merged.nluAskMessage === 'string' && merged.nluAskMessage.trim()) {
          const a = merged.nluAskMessage.trim();
          nudgeErr = baseNudgeErr ? `${a}\n\n${baseNudgeErr}` : a;
        }
        if (missParsed.includes('moviePick')) {
          const kobisE = kobisForMovieNudge ?? (await fetchDailyBoxOfficeTop10());
          kobisForMovieNudge = kobisE;
          if (kobisE.ok && kobisE.movies.length >= 3) {
            nudgeErr = appendMovieNudgeBoxOfficeRanks(baseNudgeErr, kobisE.movies);
            const picksE = kobisE.movies
              .slice(0, 3)
              .map((m) => ({ title: String(m.title ?? '').trim() }))
              .filter((x) => x.title.length > 0);
            pendingNluBoxOfficeTopThreeRef.current = picksE.length >= 3 ? picksE : null;
          } else {
            pendingNluBoxOfficeTopThreeRef.current = null;
          }
        }
        const bubble = `${nudgeErr}\n\n(${parsed.error})`;
        agentNluSessionRef.current = appendMeetingCreateAgentChatMessage(agentNluSessionRef.current, 'assistant', bubble);
        surf?.setIntelligentSuggestionDirect(bubble);
        return;
      }

      const fp = fingerprintMeetingCreateParsedPlan(parsed.plan);
      const sugg = wizardSuggestionFromNluPlan(parsed.plan, categories);
      pendingNluWizardApplyRef.current = { fp, sugg };

      setMeetingCreateNluConfirmPhase('summary');
      const confirmMsg = buildMeetingCreateNluConfirmSummary(parsed.plan, categories);
      pendingNluSummaryConfirmMsgRef.current = confirmMsg;
      agentNluSessionRef.current = appendMeetingCreateAgentChatMessage(
        agentNluSessionRef.current,
        'assistant',
        confirmMsg,
      );
      surf?.setIntelligentSuggestionDirect(confirmMsg);
      surf?.setShowAcceptButton(true);
      function runNluSummaryAccept() {
        void (async () => {
          const surfInner = agenticSurfaceRef.current;
          Keyboard.dismiss();
          setNaturalLanguageDraft('');
          setNluKeyboardDimActive(false);
          nluDimOpacity.stopAnimation();
          nluDimOpacity.setValue(0);
          setNluDimLayerMounted(false);
          notifyCreateMeetingAgentBubbleDismissFromManualScroll();
          surfInner?.setIntelligentSuggestionDirect(null);
          surfInner?.setShowAcceptButton(false);
          surfInner?.registerAcceptSuggestion(null);
          nluComposerDismissOpacity.stopAnimation();
          nluComposerDismissOpacity.setValue(0);
          setNluComposerUserDismissed(true);
          setNluBusy(true);
          try {
            setMeetingCreateNluConfirmPhase('applying');
            const pending = pendingNluWizardApplyRef.current;
            let didAutoFill = false;
            if (pending && agentNluLastFingerprintRef.current !== pending.fp) {
              await applyWizardSuggestionRef.current(pending.sugg);
              agentNluLastFingerprintRef.current = pending.fp;
              didAutoFill = true;
            }
            setMeetingCreateNluConfirmPhase('none');
            if (didAutoFill) {
              showTransientBottomMessage(
                '생성된 일정을 확인·수정한 뒤 지닛 시작하기를 눌러 모임을 등록해 주세요.',
              );
            }
          } catch (e) {
            const detail = e instanceof Error ? e.message : '알 수 없는 오류가 났습니다.';
            dismissNluAutoChromeForManualRecovery();
            setMeetingCreateNluConfirmPhase('none');
            pendingNluWizardApplyRef.current = null;
            pendingNluSummaryConfirmMsgRef.current = '';
            setWizardError(detail);
            showTransientBottomMessage(
              `자동 입력 중 문제가 생겼어요. 위저드를 직접 조정해 주세요.\n${detail}`,
            );
          } finally {
            setNluBusy(false);
          }
        })();
      }
      surf?.registerAcceptSuggestion(runNluSummaryAccept);
    } catch (e) {
      setMeetingCreateNluConfirmPhase('none');
      agentNluSessionRef.current = appendMeetingCreateAgentChatMessage(
        agentNluSessionRef.current,
        'assistant',
        MEETING_CREATE_AGENT_NLU_ERROR_RETRY_BUBBLE,
      );
      agenticSurfaceRef.current?.setIntelligentSuggestionDirect(MEETING_CREATE_AGENT_NLU_ERROR_RETRY_BUBBLE);
      const msg = e instanceof Error ? e.message : '분석에 실패했습니다.';
      setWizardError(msg);
      showTransientBottomMessage(msg);
    } finally {
      setNluBusy(false);
    }
  }, [
    aiTitleSuggestions,
    catLoading,
    categories,
    naturalLanguageDraft,
    nluComposerDismissOpacity,
    nluDimOpacity,
    paramCategoryLabel,
    selectedCategory?.label,
    dismissNluAutoChromeForManualRecovery,
    setMeetingCreateNluConfirmPhase,
    setNaturalLanguageDraft,
    setNluDimLayerMounted,
    setNluKeyboardDimActive,
    title,
    titleSuggestionCtx,
  ]);

  const onStep3BasicNext = useCallback(() => {
    setWizardError(null);
    if (!title.trim()) {
      setTitle(effectiveMeetingTitle);
    }
    const capMax = meetingCreateRules.capacityMax;
    const minFloor = Math.max(PARTICIPANT_COUNT_MIN, meetingCreateRules.minParticipantsFloor);
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
    setPlacesAiAssistGate(false);
    pendingScrollAfterStepRef.current = detailStep;
    if (getAgentFabMotionMode() === 'user') {
      notifyCreateMeetingAgentBubbleShow();
    }
    setCurrentStep(detailStep);
  }, [detailStep]);

  useEffect(() => {
    onPlacesStepConfirmRef.current = onPlacesStepConfirm;
  }, [onPlacesStepConfirm]);

  useEffect(() => {
    if (currentStep !== placesStep) {
      setPlacesAiAssistGate(false);
    }
  }, [currentStep, placesStep]);

  useEffect(() => {
    if (!placesAiAssistGate || currentStep !== placesStep) return undefined;
    const s = placeAutoSnap;
    if (
      s.searchLoading ||
      !s.queryTrim ||
      s.hasFilledPlace ||
      s.anyPlaceResolving ||
      (s.queryTrim.length > 0 && s.lastSettledQueryTrim !== s.queryTrim)
    ) {
      return undefined;
    }
    const id = setTimeout(() => {
      if (!placesAiAssistGateRef.current || currentStepRef.current !== placesStep) return;
      const snap = placeAutoSnapRef.current;
      if (
        snap.searchLoading ||
        snap.hasFilledPlace ||
        !snap.queryTrim ||
        snap.anyPlaceResolving ||
        (snap.queryTrim.length > 0 && snap.lastSettledQueryTrim !== snap.queryTrim)
      ) {
        return;
      }
      setPlacesAiAssistGate(false);
      dismissNluAutoChromeForManualRecovery();
      showTransientBottomMessage(
        '장소 후보를 고르지 않아 수동 모드로 전환했어요. 검색 결과에서 골라 확인을 눌러 주세요.',
      );
    }, 3000);
    return () => clearTimeout(id);
  }, [
    placesAiAssistGate,
    currentStep,
    placesStep,
    placeAutoSnap.searchLoading,
    placeAutoSnap.hasFilledPlace,
    placeAutoSnap.queryTrim,
    placeAutoSnap.anyPlaceResolving,
    placeAutoSnap.lastSettledQueryTrim,
    dismissNluAutoChromeForManualRecovery,
  ]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const onFinalRegister = useCallback(async (opts?: { rethrowOnAddMeetingFailure?: boolean }) => {
    setWizardError(null);
    if (meetingCreateNluConfirmPhaseRef.current !== 'none') {
      Alert.alert('확인 필요', 'AI 요약을 확인한 뒤 말풍선의 수락을 눌러 주세요.');
      return;
    }
    const cid = selectedCategory?.id?.trim() ?? '';
    const clabel = selectedCategory?.label?.trim() ?? '';
    if (!cid || !clabel) {
      Alert.alert('오류', '카테고리를 선택해 주세요.');
      return;
    }
    const capMax = meetingCreateRules.capacityMax;
    const minFloor = Math.max(PARTICIPANT_COUNT_MIN, meetingCreateRules.minParticipantsFloor);
    const feeMax = meetingCreateRules.membershipFeeWonMax;
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
      isPublicMeeting &&
      meetingConfig.settlement === 'MEMBERSHIP_FEE' &&
      (typeof meetingConfig.membershipFeeWon !== 'number' ||
        !Number.isFinite(meetingConfig.membershipFeeWon) ||
        meetingConfig.membershipFeeWon < 1)
    ) {
      setWizardError('회비 금액을 입력해 주세요.');
      Alert.alert('입력 확인', '회비를 선택한 경우 1원 이상의 금액을 입력해 주세요.');
      return;
    }
    if (isPublicMeeting && meetingConfig.settlement === 'MEMBERSHIP_FEE' && typeof meetingConfig.membershipFeeWon === 'number') {
      if (meetingConfig.membershipFeeWon > feeMax) {
        const wonLabel = `${feeMax.toLocaleString('ko-KR')}원`;
        setWizardError(`회비는 최대 ${wonLabel}까지 입력할 수 있어요.`);
        Alert.alert('입력 확인', `회비는 최대 ${wonLabel}까지 입력할 수 있어요.`);
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
      if (!opts?.rethrowOnAddMeetingFailure) {
        Alert.alert('등록 실패', msg);
      }
      if (opts?.rethrowOnAddMeetingFailure) {
        throw e instanceof Error ? e : new Error(msg);
      }
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

  onFinalRegisterRef.current = onFinalRegister;

  /** 등록 버튼: 로딩 중·NLU 요약 대기 중 비활성화. 소개글 길이는 눌렀을 때 검증(짧으면 안내). */
  const finalDisabled = busy || meetingCreateNluBlocksFloatingFinal;

  const onNluKeyboardOpenChange = useCallback((open: boolean) => {
    setNluKeyboardDimActive(open);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (nluKeyboardDimActive) {
      setNluDimLayerMounted(true);
      nluDimOpacity.stopAnimation();
      const raf = requestAnimationFrame(() => {
        if (!cancelled) {
          Animated.timing(nluDimOpacity, {
            toValue: 1,
            duration: 240,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start();
        }
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        nluDimOpacity.stopAnimation();
      };
    }
    nluDimOpacity.stopAnimation();
    Animated.timing(nluDimOpacity, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !cancelled) setNluDimLayerMounted(false);
    });
    return () => {
      cancelled = true;
      nluDimOpacity.stopAnimation();
    };
  }, [nluKeyboardDimActive, nluDimOpacity]);

  return (
    <View style={styles.screenRoot}>
      <CreateMeetingAgenticAiProvider>
        <CreateMeetingAgenticAiBootstrap />
        <CreateMeetingAgenticSurfaceBinder handlesRef={agenticSurfaceRef} />
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
          autopilotCoachLocked={autopilotCoachLocked}
        />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
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

          <View style={styles.nluWizardBodyHost}>
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
                currentStep === detailStep && { paddingBottom: 132 + insets.bottom },
                !snsDemographicsBlocked && {
                  paddingBottom:
                    (currentStep === detailStep ? 132 + insets.bottom : 120) + nluDockReservePx,
                },
              ]}>
              <View collapsable={false}>
              <View style={styles.wizardStepShell} onLayout={(e) => captureStepPosition(1, e)}>
                <Text style={styles.wizardStepBadge}>카테고리</Text>

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

                <View
                  style={styles.publicPrivStack}
                  accessibilityRole="radiogroup"
                  accessibilityLabel="모임 공개 여부">
                  <Pressable
                    onPress={() => setIsPublicMeeting(false)}
                    style={({ pressed }) => [
                      styles.publicPrivHalf,
                      !isPublicMeeting && styles.publicPrivHalfOn,
                      agentWizardApplyCue?.kind === 'public' &&
                        agentWizardApplyCue.side === 'private' &&
                        styles.publicPrivHalfAgentCue,
                      pressed && styles.publicPrivHalfPressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: !isPublicMeeting }}>
                    <AgentApplyRippleLayer
                      active={
                        agentWizardApplyCue?.kind === 'public' && agentWizardApplyCue.side === 'private'
                      }
                      size="md"
                    />
                    <View style={styles.publicPrivTextCol}>
                      <Text
                        style={[styles.publicPrivTitle, !isPublicMeeting && styles.publicPrivTitleOn]}
                        numberOfLines={1}>
                        🔒 비공개
                      </Text>
                      <Text style={styles.publicPrivSub} numberOfLines={1}>
                        (초대만)
                      </Text>
                    </View>
                  </Pressable>
                  <View style={styles.publicPrivSepVert} />
                  <Pressable
                    onPress={() => setIsPublicMeeting(true)}
                    style={({ pressed }) => [
                      styles.publicPrivHalf,
                      isPublicMeeting && styles.publicPrivHalfOn,
                      agentWizardApplyCue?.kind === 'public' &&
                        agentWizardApplyCue.side === 'public' &&
                        styles.publicPrivHalfAgentCue,
                      pressed && styles.publicPrivHalfPressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isPublicMeeting }}>
                    <AgentApplyRippleLayer
                      active={
                        agentWizardApplyCue?.kind === 'public' && agentWizardApplyCue.side === 'public'
                      }
                      size="md"
                    />
                    <View style={styles.publicPrivTextCol}>
                      <Text
                        style={[styles.publicPrivTitle, isPublicMeeting && styles.publicPrivTitleOn]}
                        numberOfLines={1}>
                        🌐 공개
                      </Text>
                      <Text style={styles.publicPrivSub} numberOfLines={1}>
                        (지역 검색)
                      </Text>
                    </View>
                  </Pressable>
                </View>


                {currentStep === 1 ? (
                  <Pressable
                    onPress={() => onStep1Next({ fromUserPress: true })}
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
                          onPlacesAutoAssistSnapshot={onPlacesAutoAssistSnapshot}
                        />
                      </View>

                      {currentStep === placesStep ? (
                        <Pressable
                          disabled={placesConfirmDisabledByAiAssist}
                          onPress={onPlacesStepConfirm}
                          style={({ pressed }) => [
                            styles.wizardPrimaryBtn,
                            placesConfirmDisabledByAiAssist && styles.addCandidateBtnDisabled,
                            pressed && !placesConfirmDisabledByAiAssist && styles.addCandidateBtnPressed,
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: placesConfirmDisabledByAiAssist }}>
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
                      style={styles.wizardStepShellBottom}
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
                                layoutAnimateMeetingCreateWizard();
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
          {!snsDemographicsBlocked ? (
            <Animated.View
              style={[styles.nluComposerOverlay, { opacity: nluComposerDismissOpacity }]}
              pointerEvents={nluComposerUserDismissed ? 'none' : 'box-none'}>
              {!nluComposerUserDismissed ? (
                <CreateMeetingNluComposerDock
                  draft={naturalLanguageDraft}
                  onChangeDraft={setNaturalLanguageDraft}
                  onSend={() => {
                    void onPressAnalyzeNaturalLanguage();
                  }}
                  onPressVoice={onPressVoiceNaturalLanguageDraft}
                  voiceRecognizing={voiceNluDraftRecognizing}
                  nluBusy={nluBusy}
                  catLoading={catLoading}
                  busy={busy}
                  horizontalBleedPx={0}
                  onDockHeightChange={setNluDockHeightPx}
                  onKeyboardOpenChange={onNluKeyboardOpenChange}
                />
              ) : null}
            </Animated.View>
          ) : null}
            </View>

          {currentStep === detailStep ? (
            <Pressable
              onPress={() => {
                void onFinalRegister();
              }}
              disabled={finalDisabled}
              style={({ pressed }) => [
                styles.detailFinalFloatingBtn,
                {
                  bottom:
                    (wizardError ? 88 : 28) +
                    insets.bottom +
                    nluDockReservePx,
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
            <Text pointerEvents="none" style={[styles.wizardFloatingError, { bottom: wizardFloatingErrorBottomPx }]}>
              {wizardError}
            </Text>
          ) : null}

          {nluDimLayerMounted && !snsDemographicsBlocked ? (
            <Pressable
              onPress={() => Keyboard.dismiss()}
              style={styles.nluKeyboardDimFullScreen}
              accessibilityRole="button"
              accessibilityLabel="키보드 내리기">
              <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: nluDimOpacity }]} pointerEvents="none">
                {shouldUseStaticGlassInsteadOfBlur() || reduceHeavyEffectsUI ? (
                  <View style={[StyleSheet.absoluteFillObject, styles.nluKeyboardDimStatic]} />
                ) : (
                  <BlurView
                    intensity={homeBlurIntensity}
                    tint="light"
                    experimentalBlurMethod="dimezisBlurView"
                    style={StyleSheet.absoluteFillObject}
                  />
                )}
              </Animated.View>
            </Pressable>
          ) : null}
      </SafeAreaView>
      {!snsDemographicsBlocked ? (
        <CreateMeetingAgenticAiFab
          layoutMode={aiFabScreenBottomLayout ? 'screenBottom' : 'cardTopRight'}
          cardWindowRect={aiFabScreenBottomLayout ? null : agentFabWindowRect}
          windowWidth={windowWidth}
          wizardStep={currentStep}
          extraScreenBottomPx={snsDemographicsBlocked ? 0 : nluDockReservePx}
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
    position: 'relative',
    backgroundColor: GinitTheme.colors.bg,
    paddingHorizontal: GinitTheme.spacing.md,
  },
  /** NLU 키보드 시 SafeArea 전역 흐림(전체 높이). NLU 도크는 zIndex 120으로 위에 표시, AI FAB는 SafeArea 밖 */
  nluKeyboardDimFullScreen: {
    position: 'absolute',
    left: -GinitTheme.spacing.md,
    right: -GinitTheme.spacing.md,
    top: 0,
    bottom: 0,
    zIndex: 105,
    overflow: 'hidden',
  },
  nluKeyboardDimStatic: {
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
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
  /** NLU 도크 absolute 기준 — 스크롤이 세로 전체를 쓰도록 */
  nluWizardBodyHost: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  /** safeArea `paddingHorizontal` 상쇄 + 스크롤 위 z-order */
  nluComposerOverlay: {
    position: 'absolute',
    left: -GinitTheme.spacing.md,
    right: -GinitTheme.spacing.md,
    bottom: 0,
    zIndex: 120,
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
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
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
  /** 제목·주소 각 2줄 + 카카오·네이버 버튼까지 포함(이미지 112 + 여백) — `overflow: hidden` 호스트에 맞춤 */
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
  /** 가로 캐러셀(`placeResultsCarouselHost` 274) − 세로 패딩 20 기준 — 카카오·네이버 버튼을 카드 하단에 고정 */
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
  wizardStepShellBottom: {
    marginBottom: 100,
    borderRadius: GinitTheme.radius.card,
    padding: 12,
    backgroundColor: GinitTheme.colors.surface,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    ...GinitTheme.shadow.card,
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
  publicPrivStack: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'center',
    width: '100%',
    marginTop: 15,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: '#FFFFFF',
  },
  publicPrivHalf: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 6,
    minWidth: 0,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  publicPrivHalfOn: {
    borderWidth: 1,
    borderRadius: 14,
    borderColor: GinitTheme.colors.primary,
    backgroundColor: GinitTheme.colors.primarySoft,
  },
  publicPrivHalfAgentCue: {
    opacity: 0.88,
  },
  publicPrivHalfPressed: {
    opacity: 0.82,
  },
  publicPrivSepVert: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: GinitTheme.colors.border,
  },
  publicPrivTextCol: {
    maxWidth: '100%',
    alignItems: 'center',
  },
  publicPrivTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    textAlign: 'center',
  },
  publicPrivTitleOn: {
    color: GinitTheme.colors.primary,
  },
  publicPrivSub: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    textAlign: 'center',
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
    bottom: 0,
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
