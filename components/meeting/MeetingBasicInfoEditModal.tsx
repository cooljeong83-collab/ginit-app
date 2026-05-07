import {
  CAPACITY_UNLIMITED,
  GlassDualCapacityWheel,
  PARTICIPANT_COUNT_MIN,
} from '@/components/create/GlassDualCapacityWheel';
import { GlassSingleCapacityWheel } from '@/components/create/GlassSingleCapacityWheel';
import { PublicMeetingDetailsCard } from '@/components/create/PublicMeetingDetailsCard';
import { KeyboardAwareScreenScroll } from '@/components/ui';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { deferSoftInputUntilUserTapProps } from '@/src/lib/defer-soft-input-until-user-tap';
import type { Meeting, PublicMeetingDetailsConfig } from '@/src/lib/meetings';
import {
  DEFAULT_PUBLIC_MEETING_DETAILS_CONFIG,
  normalizeProfileGenderToHostSnapshot,
  parsePublicMeetingDetailsConfig,
  updateMeetingBasicFieldsByHost,
} from '@/src/lib/meetings';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { getUserProfile, meetingDemographicsIncomplete } from '@/src/lib/user-profile';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { type ElementRef, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  findNodeHandle,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  useWindowDimensions,
  View,
  type KeyboardEvent,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const INPUT_PLACEHOLDER = '#94a3b8';

/** 긴 텍스트에서 네이티브 가로·세로 스크롤이 끝으로 잡힐 때, 보이는 영역을 맨 앞(첫 글자·첫 줄)으로 맞춤 */
function bumpTextInputToVisualStart(ref: RefObject<TextInput | null>) {
  const node = ref.current;
  if (!node) return;
  node.setNativeProps?.({ selection: { start: 0, end: 0 } });
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

export type MeetingBasicInfoEditModalProps = {
  visible: boolean;
  meeting: Meeting | null;
  hostUserId: string | null;
  onClose: () => void;
  onSaved?: () => void;
};

export function MeetingBasicInfoEditModal({
  visible,
  meeting,
  hostUserId,
  onClose,
  onSaved,
}: MeetingBasicInfoEditModalProps) {
  const router = useRouter();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  /** 시트 상·하에 남길 최소 여백(px) — 노치·홈 인디케이터 제외 후 최대 높이 */
  const sheetEdgeMargin = 8;
  const sheetWindowMaxHeight = Math.round(
    Math.max(220, windowHeight - insets.top - insets.bottom - sheetEdgeMargin * 2),
  );
  const sheetMaxWidth = Math.min(440, Math.max(280, windowWidth - 32));
  /** wizardStepShell 실측 높이 — 소개 입력까지 포함 */
  const [wizardShellLayoutHeight, setWizardShellLayoutHeight] = useState(0);
  /** 시트 paddingTop + 헤더(한 줄 + marginBottom) */
  const sheetChromeAboveFormPx = 16 + 20;
  /** 푸터 행 + 시트 paddingBottom */
  const sheetChromeBelowFormPx = 60 + 12;
  const scrollContentBottomSlackPx = 28;
  const sheetHeightFromContent = useMemo(() => {
    if (wizardShellLayoutHeight <= 0) {
      return Math.min(sheetWindowMaxHeight, 560);
    }
    const body =
      wizardShellLayoutHeight +
      scrollContentBottomSlackPx +
      sheetChromeAboveFormPx +
      sheetChromeBelowFormPx;
    return Math.min(sheetWindowMaxHeight, Math.max(240, Math.round(body)));
  }, [
    wizardShellLayoutHeight,
    sheetWindowMaxHeight,
    scrollContentBottomSlackPx,
    sheetChromeAboveFormPx,
    sheetChromeBelowFormPx,
  ]);
  const titleInputRef = useRef<TextInput>(null);
  const descInputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ElementRef<typeof KeyboardAwareScrollView> | null>(null);
  const descFieldFocusedRef = useRef(false);
  /** 소개 입력 포커스 + 키보드 시 시트를 키보드 높이만큼 위로 이동(px) */
  const [sheetKeyboardLiftPx, setSheetKeyboardLiftPx] = useState(0);

  const titleDeferKb = useMemo(
    () =>
      deferSoftInputUntilUserTapProps(titleInputRef, {
        onFocus: () => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => bumpTextInputToVisualStart(titleInputRef));
          });
        },
        onBlur: () => {
          requestAnimationFrame(() => bumpTextInputToVisualStart(titleInputRef));
        },
      }),
    [],
  );

  const scrollDescIntoView = useCallback(() => {
    const input = descInputRef.current;
    const sv = scrollRef.current;
    if (!input || !sv) return;
    const scrollHandle = findNodeHandle(sv);
    const inputHandle = findNodeHandle(input);
    if (scrollHandle == null || inputHandle == null) return;
    UIManager.measureLayout(
      inputHandle,
      scrollHandle,
      () => {},
      (_x, y, _w, _h) => {
        sv.scrollTo({ x: 0, y: Math.max(0, y - 60), animated: true });
      },
    );
  }, []);

  const descDeferKb = useMemo(
    () =>
      deferSoftInputUntilUserTapProps(descInputRef, {
        onPressIn: () => {
          descFieldFocusedRef.current = true;
        },
        onFocus: () => {
          descFieldFocusedRef.current = true;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => bumpTextInputToVisualStart(descInputRef));
          });
          scrollDescIntoView();
          setTimeout(scrollDescIntoView, 200);
          setTimeout(scrollDescIntoView, 450);
        },
        onBlur: () => {
          descFieldFocusedRef.current = false;
          setSheetKeyboardLiftPx(0);
          requestAnimationFrame(() => bumpTextInputToVisualStart(descInputRef));
        },
      }),
    [scrollDescIntoView],
  );

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublicMeeting, setIsPublicMeeting] = useState(true);
  const [minParticipants, setMinParticipants] = useState(PARTICIPANT_COUNT_MIN);
  const [maxParticipants, setMaxParticipants] = useState(4);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [meetingConfigDraft, setMeetingConfigDraft] = useState<PublicMeetingDetailsConfig>(
    DEFAULT_PUBLIC_MEETING_DETAILS_CONFIG,
  );
  /** 공개 모임에서 `meetingConfig`가 서버에 있었거나, 상세 조건 팝업에서 한 번 저장됨 */
  const [publicDetailsAck, setPublicDetailsAck] = useState(false);
  const [publicDetailsModalOpen, setPublicDetailsModalOpen] = useState(false);
  const [publicDetailsError, setPublicDetailsError] = useState<string | null>(null);
  const [publicDetailsBusy, setPublicDetailsBusy] = useState(false);
  /** 상세 조건 팝업 취소 시 비공개로 되돌릴지(비공개→공개 직후에만 true) */
  const revertPublicOnDetailsCancelRef = useRef(false);

  const [voiceTitleRecognizing, setVoiceTitleRecognizing] = useState(false);
  const [voiceDescriptionRecognizing, setVoiceDescriptionRecognizing] = useState(false);
  const voiceEditTargetRef = useRef<'title' | 'description' | null>(null);

  useSpeechRecognitionEvent('start', () => {
    const k = voiceEditTargetRef.current;
    if (k === 'title') setVoiceTitleRecognizing(true);
    if (k === 'description') setVoiceDescriptionRecognizing(true);
  });
  useSpeechRecognitionEvent('end', () => {
    const k = voiceEditTargetRef.current;
    if (!k) return;
    setVoiceTitleRecognizing(false);
    setVoiceDescriptionRecognizing(false);
    voiceEditTargetRef.current = null;
  });
  useSpeechRecognitionEvent('error', (event) => {
    const k = voiceEditTargetRef.current;
    if (!k) return;
    setVoiceTitleRecognizing(false);
    setVoiceDescriptionRecognizing(false);
    voiceEditTargetRef.current = null;
    Alert.alert('음성 입력 오류', humanizeSpeechRecognitionError(event));
  });
  useSpeechRecognitionEvent('result', (event) => {
    const t = String(event?.results?.[0]?.transcript ?? '').trim();
    if (!t) return;
    const k = voiceEditTargetRef.current;
    if (!k) return;
    if (k === 'title') setTitle(t);
    if (k === 'description') setDescription(t);
    if (event?.isFinal) {
      const which = k;
      setVoiceTitleRecognizing(false);
      setVoiceDescriptionRecognizing(false);
      voiceEditTargetRef.current = null;
      ExpoSpeechRecognitionModule.stop();
      setTimeout(() => {
        if (which === 'title') bumpTextInputToVisualStart(titleInputRef);
        if (which === 'description') bumpTextInputToVisualStart(descInputRef);
      }, 0);
    }
  });

  const onPressVoiceInputTitle = useCallback(async () => {
    if (saving) return;
    if (voiceTitleRecognizing || voiceDescriptionRecognizing) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '음성 입력을 사용하려면 마이크/음성 인식 권한이 필요합니다.');
      return;
    }
    voiceEditTargetRef.current = 'title';
    ExpoSpeechRecognitionModule.start({
      lang: 'ko-KR',
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
    });
  }, [saving, voiceDescriptionRecognizing, voiceTitleRecognizing]);

  const onPressVoiceInputDescription = useCallback(async () => {
    if (saving) return;
    if (voiceTitleRecognizing || voiceDescriptionRecognizing) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '음성 입력을 사용하려면 마이크/음성 인식 권한이 필요합니다.');
      return;
    }
    voiceEditTargetRef.current = 'description';
    ExpoSpeechRecognitionModule.start({
      lang: 'ko-KR',
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
    });
  }, [saving, voiceDescriptionRecognizing, voiceTitleRecognizing]);

  useEffect(() => {
    if (!visible) {
      voiceEditTargetRef.current = null;
      setVoiceTitleRecognizing(false);
      setVoiceDescriptionRecognizing(false);
      void ExpoSpeechRecognitionModule.stop();
      descFieldFocusedRef.current = false;
      setSheetKeyboardLiftPx(0);
      setWizardShellLayoutHeight(0);
      setPublicDetailsModalOpen(false);
      setPublicDetailsError(null);
      revertPublicOnDetailsCancelRef.current = false;
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || Platform.OS === 'web') return;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => {
      if (!descFieldFocusedRef.current) return;
      const h = Math.round(e.endCoordinates?.height ?? 0);
      if (h > 0) setSheetKeyboardLiftPx(h);
    };
    const onHide = () => {
      setSheetKeyboardLiftPx(0);
    };
    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [visible]);

  const minParticipantsRef = useRef(minParticipants);
  const maxParticipantsRef = useRef(maxParticipants);
  minParticipantsRef.current = minParticipants;
  maxParticipantsRef.current = maxParticipants;

  const prevVisibleRef = useRef(false);
  const prevIsPublicForCapacityRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!visible) {
      prevIsPublicForCapacityRef.current = null;
    }
  }, [visible]);

  useEffect(() => {
    const was = prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (!visible || was) return;
    if (!meeting) return;
    setFormError(null);
    setTitle(meeting.title?.trim() ?? '');
    setDescription(meeting.description?.trim() ?? '');
    const pub = meeting.isPublic !== false;
    setIsPublicMeeting(pub);
    const parsedCfg = parsePublicMeetingDetailsConfig(meeting.meetingConfig);
    setMeetingConfigDraft(parsedCfg ?? DEFAULT_PUBLIC_MEETING_DETAILS_CONFIG);
    setPublicDetailsAck(pub && parsedCfg != null);
    if (pub) {
      const min = Math.max(PARTICIPANT_COUNT_MIN, Math.min(100, meeting.minParticipants ?? PARTICIPANT_COUNT_MIN));
      const cap = meeting.capacity;
      const max =
        cap === CAPACITY_UNLIMITED
          ? CAPACITY_UNLIMITED
          : Math.max(min, Math.min(100, Number.isFinite(cap) ? cap : 4));
      setMinParticipants(min);
      setMaxParticipants(max);
    } else {
      const cap = meeting.capacity;
      const n = Math.max(PARTICIPANT_COUNT_MIN, Math.min(100, Number.isFinite(cap) && cap > 0 ? cap : 4));
      setMinParticipants(n);
      setMaxParticipants(n);
    }
    /** 레이아웃·포커스 이후에도 스크롤이 다시 끝으로 가는 경우가 있어 여러 타이밍에 재보정 */
    const bumpBoth = () => {
      requestAnimationFrame(() => {
        bumpTextInputToVisualStart(titleInputRef);
        bumpTextInputToVisualStart(descInputRef);
      });
    };
    const timeouts = [0, 32, 120, 280].map((ms) => setTimeout(bumpBoth, ms));
    return () => timeouts.forEach(clearTimeout);
  }, [visible, meeting]);

  useEffect(() => {
    const prev = prevIsPublicForCapacityRef.current;
    prevIsPublicForCapacityRef.current = isPublicMeeting;
    if (prev === null) return;
    if (prev === true && isPublicMeeting === false) {
      const min = minParticipantsRef.current;
      const max = maxParticipantsRef.current;
      const n =
        max === CAPACITY_UNLIMITED || max > 100
          ? Math.min(100, Math.max(PARTICIPANT_COUNT_MIN, min))
          : Math.min(100, Math.max(PARTICIPANT_COUNT_MIN, max));
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
          ? Math.min(100, Math.max(PARTICIPANT_COUNT_MIN, min))
          : Math.min(100, Math.max(PARTICIPANT_COUNT_MIN, max));
      setMinParticipants(n);
      setMaxParticipants(n);
    }
  }, [isPublicMeeting, maxParticipants, minParticipants]);

  const onMinParticipantsChange = useCallback((v: number) => {
    setMinParticipants(v);
    setMaxParticipants((prev) => {
      if (prev === CAPACITY_UNLIMITED) return prev;
      return Math.max(v, prev);
    });
  }, []);

  const onPrivateAttendeesChange = useCallback((v: number) => {
    setMinParticipants(v);
    setMaxParticipants(v);
  }, []);

  const validateAndSave = useCallback(async () => {
    setFormError(null);
    if (!meeting || !hostUserId?.trim()) {
      setFormError('저장할 수 없습니다.');
      return;
    }
    if (!title.trim()) {
      setFormError('모임 이름을 입력해 주세요.');
      return;
    }
    if (isPublicMeeting) {
      if (!publicDetailsAck) {
        setFormError('「🌐 공개」를 눌러 상세 조건을 확인·저장한 뒤 다시 저장해 주세요.');
        return;
      }
      if (!Number.isFinite(minParticipants) || minParticipants < PARTICIPANT_COUNT_MIN || minParticipants > 100) {
        setFormError('최소 인원을 선택해 주세요.');
        return;
      }
      if (
        !Number.isFinite(maxParticipants) ||
        (maxParticipants !== CAPACITY_UNLIMITED && maxParticipants < PARTICIPANT_COUNT_MIN) ||
        maxParticipants < minParticipants ||
        (maxParticipants > 100 && maxParticipants !== CAPACITY_UNLIMITED)
      ) {
        setFormError('최대 인원을 선택해 주세요.');
        return;
      }
      if (
        meetingConfigDraft.settlement === 'MEMBERSHIP_FEE' &&
        (typeof meetingConfigDraft.membershipFeeWon !== 'number' ||
          !Number.isFinite(meetingConfigDraft.membershipFeeWon) ||
          meetingConfigDraft.membershipFeeWon < 1 ||
          meetingConfigDraft.membershipFeeWon > 100_000)
      ) {
        setFormError('상세 조건의 회비를 1원 이상 10만 원 이하로 맞춘 뒤 「공개」에서 다시 저장해 주세요.');
        return;
      }
    } else {
      if (
        !Number.isFinite(minParticipants) ||
        minParticipants < PARTICIPANT_COUNT_MIN ||
        minParticipants > 100 ||
        minParticipants !== maxParticipants ||
        maxParticipants === CAPACITY_UNLIMITED
      ) {
        setFormError('참석 인원을 선택해 주세요.');
        return;
      }
    }

    const capOut = isPublicMeeting ? maxParticipants : minParticipants;
    const minOut = isPublicMeeting ? minParticipants : minParticipants;

    let meetingConfigForSave: PublicMeetingDetailsConfig | null = null;
    if (isPublicMeeting) {
      let hostProfile: Awaited<ReturnType<typeof getUserProfile>> = null;
      try {
        hostProfile = await getUserProfile(hostUserId.trim());
      } catch {
        /* 저장 시 서버·RPC에서도 검증 */
      }
      if (meetingConfigDraft.genderRatio === 'SAME_GENDER_ONLY') {
        if (meetingDemographicsIncomplete(hostProfile, hostUserId.trim())) {
          setFormError('동성 모집은 프로필 성별·연령대 등록 후 저장할 수 있어요.');
          return;
        }
        const snap = normalizeProfileGenderToHostSnapshot(hostProfile?.gender ?? null);
        if (snap == null) {
          setFormError('동성 모집은 프로필에 성별을 입력한 뒤 저장해 주세요.');
          return;
        }
        meetingConfigForSave = { ...meetingConfigDraft, hostGenderSnapshot: snap };
      } else {
        meetingConfigForSave = { ...meetingConfigDraft };
      }
    }

    setSaving(true);
    try {
      await updateMeetingBasicFieldsByHost(meeting.id, hostUserId.trim(), {
        title: title.trim(),
        description: description.trim(),
        isPublic: isPublicMeeting,
        capacity: capOut,
        minParticipants: minOut,
        meetingConfig: meetingConfigForSave,
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [
    meeting,
    hostUserId,
    title,
    description,
    isPublicMeeting,
    minParticipants,
    maxParticipants,
    onClose,
    onSaved,
    publicDetailsAck,
    meetingConfigDraft,
  ]);

  const onPressPublicSegment = useCallback(() => {
    if (saving) return;
    const wasPublic = isPublicMeeting;
    setIsPublicMeeting(true);
    /** 비공개→공개 전환, 또는 서버에 상세 조건이 없는 공개 모임 → 팝업 */
    if (!wasPublic || !publicDetailsAck) {
      revertPublicOnDetailsCancelRef.current = !wasPublic;
      setPublicDetailsModalOpen(true);
    }
  }, [isPublicMeeting, publicDetailsAck, saving]);

  const onPressPrivateSegment = useCallback(() => {
    if (saving) return;
    setIsPublicMeeting(false);
    setPublicDetailsAck(false);
    setPublicDetailsModalOpen(false);
    revertPublicOnDetailsCancelRef.current = false;
  }, [saving]);

  const onCancelPublicDetailsModal = useCallback(() => {
    if (publicDetailsBusy) return;
    setPublicDetailsError(null);
    if (revertPublicOnDetailsCancelRef.current) {
      setIsPublicMeeting(false);
    }
    revertPublicOnDetailsCancelRef.current = false;
    setPublicDetailsModalOpen(false);
  }, [publicDetailsBusy]);

  const onSavePublicDetailsModal = useCallback(async () => {
    if (!hostUserId?.trim()) {
      setPublicDetailsError('로그인 정보를 확인해 주세요.');
      return;
    }
    setPublicDetailsError(null);
    if (
      meetingConfigDraft.settlement === 'MEMBERSHIP_FEE' &&
      (typeof meetingConfigDraft.membershipFeeWon !== 'number' ||
        !Number.isFinite(meetingConfigDraft.membershipFeeWon) ||
        meetingConfigDraft.membershipFeeWon < 1)
    ) {
      setPublicDetailsError('회비를 선택한 경우 1원 이상 입력해 주세요.');
      return;
    }
    if (
      meetingConfigDraft.settlement === 'MEMBERSHIP_FEE' &&
      typeof meetingConfigDraft.membershipFeeWon === 'number' &&
      meetingConfigDraft.membershipFeeWon > 100_000
    ) {
      setPublicDetailsError('회비는 최대 10만 원까지 입력할 수 있어요.');
      return;
    }
    setPublicDetailsBusy(true);
    try {
      let hostProfile: Awaited<ReturnType<typeof getUserProfile>> = null;
      try {
        hostProfile = await getUserProfile(hostUserId.trim());
      } catch {
        /* 아래 분기에서 동성만 추가 검증 */
      }
      if (meetingConfigDraft.genderRatio === 'SAME_GENDER_ONLY') {
        if (meetingDemographicsIncomplete(hostProfile, hostUserId.trim())) {
          Alert.alert(
            '프로필을 먼저 완성해 주세요',
            'SNS 간편 가입 계정은 프로필에서 성별과 연령대를 입력한 뒤 모임을 만들 수 있어요.',
            [
              { text: '닫기', style: 'cancel' },
              { text: '정보 등록하기', onPress: () => pushProfileOpenRegisterInfo(router) },
            ],
          );
          return;
        }
        if (normalizeProfileGenderToHostSnapshot(hostProfile?.gender ?? null) == null) {
          Alert.alert('프로필 확인', '동성 모집은 프로필에 성별을 입력한 뒤 저장할 수 있어요.', [
            { text: '닫기', style: 'cancel' },
            { text: '정보 등록하기', onPress: () => pushProfileOpenRegisterInfo(router) },
          ]);
          return;
        }
      }
      setPublicDetailsAck(true);
      revertPublicOnDetailsCancelRef.current = false;
      setPublicDetailsModalOpen(false);
    } finally {
      setPublicDetailsBusy(false);
    }
  }, [hostUserId, meetingConfigDraft, router]);

  const publicDetailsSheetMaxH = Math.round(sheetWindowMaxHeight * 0.9);

  return (
    <>
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => !saving && onClose()}>
      <View style={styles.modalRoot}>
        <Pressable
          style={styles.backdrop}
          onPress={() => !saving && onClose()}
          accessibilityRole="button"
          accessibilityLabel="닫기"
        />
        <View style={styles.centerOuter} pointerEvents="box-none">
          <View
            style={[
              styles.sheet,
              {
                height: sheetHeightFromContent,
                maxHeight: sheetWindowMaxHeight,
                maxWidth: sheetMaxWidth,
              },
              sheetKeyboardLiftPx > 0 ? { transform: [{ translateY: -sheetKeyboardLiftPx }] } : null,
            ]}>
          <Text style={styles.headerTitle}>기본 정보 수정</Text>
          <KeyboardAwareScreenScroll
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollContentBottomSlackPx }]}
            contentContainerFlexGrow={false}
            viewIsInsideTabBar={false}
            extraScrollHeight={40}
            extraHeight={100}
            scrollProps={{
              nestedScrollEnabled: true,
              keyboardShouldPersistTaps: 'handled',
              showsVerticalScrollIndicator: false,
            }}
          >
            <View
              style={styles.wizardStepShell}
              onLayout={(e) => setWizardShellLayoutHeight(e.nativeEvent.layout.height)}
              collapsable={false}>
              <Text style={styles.wizardFieldLabel}>모임 이름</Text>
              <LinearGradient
                colors={[...GinitTheme.colors.brandGradient, GinitTheme.colors.ctaGradient[1]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.aiQuickInitBorder, { marginBottom: 0 }]}>
                <View style={[styles.aiQuickInitInner, { minHeight: 0, paddingVertical: 10 }]}>
                  <View style={styles.voiceInputRow}>
                    <TextInput
                      ref={titleInputRef}
                      {...titleDeferKb}
                      value={title}
                      onChangeText={setTitle}
                      placeholder="모임 이름을 입력하세요"
                      placeholderTextColor={INPUT_PLACEHOLDER}
                      style={[styles.aiQuickInitInput, styles.meetingTitleInput, styles.voiceInput, { minHeight: 0 }]}
                      editable={!saving}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="default"
                      inputMode="text"
                      underlineColorAndroid="transparent"
                      textAlign="left"
                    />
                    <Pressable
                      onPress={() => void onPressVoiceInputTitle()}
                      disabled={saving}
                      style={({ pressed }) => [
                        styles.voiceBtn,
                        saving && styles.voiceBtnDisabled,
                        pressed && !saving && styles.voiceBtnPressed,
                      ]}
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

              {isPublicMeeting ? (
                <>
                  <Text style={[styles.wizardFieldLabel, { marginTop: 16 }]}>참가 인원</Text>
                  <GlassDualCapacityWheel
                    minValue={minParticipants}
                    maxValue={maxParticipants}
                    onMinChange={onMinParticipantsChange}
                    onMaxChange={setMaxParticipants}
                    disabled={saving}
                  />
                </>
              ) : (
                <>
                  <Text style={[styles.wizardFieldLabel, { marginTop: 16 }]}>참석 인원</Text>
                  <GlassSingleCapacityWheel
                    value={minParticipants}
                    onChange={onPrivateAttendeesChange}
                    disabled={saving}
                  />
                </>
              )}

              <Text style={[styles.wizardFieldLabel, { marginTop: 16 }]}>공개 / 비공개</Text>
              <View style={styles.segmentRow}>
                <Pressable
                  onPress={onPressPrivateSegment}
                  style={[styles.segmentHalf, !isPublicMeeting && styles.segmentHalfOn]}
                  accessibilityRole="button">
                  <Text style={[styles.segmentTitle, !isPublicMeeting && styles.segmentTitleOn]}>🔒 비공개</Text>
                  <Text style={styles.segmentSub}>(초대만)</Text>
                </Pressable>
                <Pressable
                  onPress={onPressPublicSegment}
                  style={[styles.segmentHalf, isPublicMeeting && styles.segmentHalfOn]}
                  accessibilityRole="button">
                  <Text style={[styles.segmentTitle, isPublicMeeting && styles.segmentTitleOn]}>🌐 공개</Text>
                  <Text style={styles.segmentSub}>(지역 검색)</Text>
                </Pressable>
              </View>
              {isPublicMeeting && publicDetailsAck ? (
                <Pressable
                  onPress={() => {
                    if (saving) return;
                    revertPublicOnDetailsCancelRef.current = false;
                    setPublicDetailsModalOpen(true);
                  }}
                  style={({ pressed }) => [styles.publicDetailsEditLink, pressed && { opacity: 0.82 }]}
                  accessibilityRole="button"
                  accessibilityLabel="공개 모임 상세 조건 수정">
                  <Text style={styles.publicDetailsEditLinkText}>상세 조건 수정</Text>
                </Pressable>
              ) : null}

              <Text style={[styles.wizardFieldLabel, { marginTop: 16 }]}>소개</Text>
              <View style={styles.descVoiceShell}>
                <TextInput
                  ref={descInputRef}
                  {...descDeferKb}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="모임 소개를 입력하세요"
                  placeholderTextColor={GinitTheme.glassModal.placeholder}
                  style={[
                    styles.wizardTextInput,
                    styles.wizardTextInputMultiline,
                    styles.descIntroInput,
                    styles.descInputWithVoiceFab,
                  ]}
                  editable={!saving}
                  multiline
                  textAlignVertical="top"
                  underlineColorAndroid="transparent"
                  textAlign="left"
                />
                <Pressable
                  onPress={() => void onPressVoiceInputDescription()}
                  disabled={saving}
                  style={({ pressed }) => [
                    styles.voiceBtn,
                    styles.descVoiceFab,
                    saving && styles.voiceBtnDisabled,
                    pressed && !saving && styles.voiceBtnPressed,
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

              {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
            </View>
          </KeyboardAwareScreenScroll>

          <View style={styles.footer}>
            <Pressable
              onPress={() => !saving && onClose()}
              style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.85 }]}
              accessibilityRole="button">
              <Text style={styles.ghostBtnText}>취소</Text>
            </Pressable>
            <Pressable
              onPress={() => void validateAndSave()}
              disabled={saving}
              style={({ pressed }) => [styles.primaryBtn, (pressed || saving) && { opacity: saving ? 0.7 : 0.9 }]}
              accessibilityRole="button">
              <LinearGradient
                colors={GinitTheme.colors.ctaGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              />
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnLabel}>저장</Text>
              )}
            </Pressable>
          </View>
          </View>
        </View>
      </View>
    </Modal>

    <Modal
      visible={publicDetailsModalOpen}
      animationType="fade"
      transparent
      onRequestClose={() => !publicDetailsBusy && onCancelPublicDetailsModal()}>
      <View style={styles.modalRoot}>
        <Pressable
          style={styles.backdrop}
          onPress={() => !publicDetailsBusy && onCancelPublicDetailsModal()}
          accessibilityRole="button"
          accessibilityLabel="닫기"
        />
        <View style={styles.centerOuter} pointerEvents="box-none">
          <View
            style={[
              styles.publicDetailsSheet,
              {
                maxHeight: publicDetailsSheetMaxH,
                maxWidth: sheetMaxWidth,
                paddingBottom: Math.max(12, insets.bottom),
              },
            ]}>
            <Text style={styles.headerTitle}>상세 조건 (선택)</Text>
            <Text style={styles.publicDetailsHint}>
              공개 모임은 연령·정산·참가 자격 등을 설정할 수 있어요. 아래에서 조정한 뒤 저장해 주세요.
            </Text>
            <ScrollView
              style={styles.publicDetailsScroll}
              contentContainerStyle={styles.publicDetailsScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <View style={styles.publicDetailsCardShell}>
                <PublicMeetingDetailsCard
                  reduceHeavyEffects
                  value={meetingConfigDraft}
                  onChange={setMeetingConfigDraft}
                />
              </View>
            </ScrollView>
            {publicDetailsError ? <Text style={styles.errorText}>{publicDetailsError}</Text> : null}
            <View style={styles.footer}>
              <Pressable
                onPress={() => !publicDetailsBusy && onCancelPublicDetailsModal()}
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button">
                <Text style={styles.ghostBtnText}>취소</Text>
              </Pressable>
              <Pressable
                onPress={() => void onSavePublicDetailsModal()}
                disabled={publicDetailsBusy}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  (pressed || publicDetailsBusy) && { opacity: publicDetailsBusy ? 0.7 : 0.9 },
                ]}
                accessibilityRole="button">
                <LinearGradient
                  colors={GinitTheme.colors.ctaGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                  pointerEvents="none"
                />
                {publicDetailsBusy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryBtnLabel}>저장</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  centerOuter: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  sheet: {
    alignSelf: 'center',
    width: '100%',
    flexDirection: 'column',
    backgroundColor: GinitTheme.colors.bg,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    ...GinitTheme.shadow.float,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: GinitTheme.colors.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  /** paddingBottom은 contentContainerStyle 인라인에서 소량만 사용 */
  scrollContent: {},
  wizardStepShell: {
    marginBottom: 4,
    borderRadius: GinitTheme.radius.card,
    padding: 12,
    backgroundColor: GinitTheme.colors.surface,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    ...GinitTheme.shadow.card,
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
  wizardFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
    marginBottom: 8,
    marginTop: 8,
    marginLeft: 8,
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
  /** 모임 이름: 가로 왼쪽 정렬(RTL 기기에서도 제목 앞부분이 보이도록) */
  meetingTitleInput: {
    textAlign: 'left',
    writingDirection: 'ltr',
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
    backgroundColor: 'rgb(255, 255, 255)',
    borderWidth: 1,
    borderColor: 'rgba(31, 42, 68, 0.45)',
  },
  voiceBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  voiceBtnDisabled: {
    opacity: 0.45,
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
  descVoiceShell: {
    position: 'relative',
  },
  descVoiceFab: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    zIndex: 2,
  },
  descInputWithVoiceFab: {
    paddingRight: 52,
    paddingBottom: 48,
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
  },
  segmentHalfOn: {
    backgroundColor: 'rgba(31, 42, 68, 0.06)',
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
  publicDetailsEditLink: {
    alignSelf: 'flex-end',
    marginTop: 8,
    marginRight: 4,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  publicDetailsEditLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
    textDecorationLine: 'underline',
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
    height: 120,
    maxHeight: 120,
    textAlignVertical: 'top',
  },
  /** 소개: 세로 상단·가로 왼쪽 (Android 폰트 패딩 제거로 첫 줄이 박스 상단에 붙음) */
  descIntroInput: {
    textAlign: 'left',
    writingDirection: 'ltr',
    textAlignVertical: 'top',
    ...Platform.select({
      android: { includeFontPadding: false },
      default: {},
    }),
  },
  errorText: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.danger,
    marginLeft: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GinitTheme.colors.border,
  },
  ghostBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.surfaceStrong,
  },
  ghostBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
  },
  primaryBtn: {
    minWidth: 120,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  publicDetailsSheet: {
    alignSelf: 'center',
    width: '100%',
    flexDirection: 'column',
    backgroundColor: GinitTheme.colors.bg,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    ...GinitTheme.shadow.float,
  },
  publicDetailsHint: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    marginBottom: 10,
    lineHeight: 17,
  },
  publicDetailsScroll: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 120,
  },
  publicDetailsScrollContent: {
    paddingBottom: 8,
  },
  publicDetailsCardShell: {
    borderRadius: GinitTheme.radius.card,
    padding: 10,
    backgroundColor: GinitTheme.colors.surface,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
});
