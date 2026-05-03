import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { AgentCoachPhase, AgentHydrationStatus, AgentWelcomeSnapshot } from '@/src/lib/agentic-guide/types';

/** 아침·점심·저녁 등 시간대(실제 날씨·스케줄 주입 시 확장) */
export type AgenticTimeSlot = 'morning' | 'lunch' | 'afternoon' | 'evening' | 'night';

/** 가상 날씨 성향(추후 API 매핑) */
export type AgenticWeatherMood = 'clear' | 'cloudy' | 'rain' | 'wind' | 'snow';

/** 말풍선 기본 지능형 제안(주입 없을 때). */
export const DEFAULT_AGENT_INTELLIGENT_SUGGESTION =
  "데이터 분석 결과, 오늘 저녁엔 '미팅' 모임의 매칭 확률이 평소보다 20% 높습니다. 🔥";

/**
 * 에이전틱 AI 말풍선·추천 문구에 쓰는 정적 컨텍스트.
 * 이후 실제 날씨/역지오코딩/유저 닉네임 등을 Provider에서 setInjectedData로 덮어쓰면 됨.
 */
export type CreateMeetingAgenticAiInjectedData = {
  timeSlot: AgenticTimeSlot;
  weatherMood: AgenticWeatherMood;
  /** 체감 온도(가상), 없으면 문구에서 생략 */
  temperatureC: number | null;
  /** 예: "지하철역 근처", "한강 공원 쪽" */
  locationHint: string | null;
  /** 선택: 호칭·닉네임 */
  displayName: string | null;
  /**
   * 비어 있지 않으면 말풍선에 이 문구를 우선 표시.
   * 비우면 `buildMzAgentMessage` 기반 MZ 문구로 폴백.
   */
  intelligentSuggestion: string | null;
};

export type CreateMeetingAgenticAiContextValue = {
  data: CreateMeetingAgenticAiInjectedData;
  /** 부분 갱신 — 실제 API 연동 시 사용 */
  setInjectedData: (patch: Partial<CreateMeetingAgenticAiInjectedData>) => void;
  /** `intelligentSuggestion` 없이 mzLine만 덮을 때(생각 중·패턴 문구) */
  setIntelligentSuggestionDirect: (text: string | null) => void;
  hydrationStatus: AgentHydrationStatus;
  setHydrationStatus: (s: AgentHydrationStatus) => void;
  coachPhase: AgentCoachPhase | null;
  setCoachPhase: (p: AgentCoachPhase | null) => void;
  agentSnapshot: AgentWelcomeSnapshot | null;
  setAgentSnapshot: (s: AgentWelcomeSnapshot | null) => void;
  showAcceptButton: boolean;
  setShowAcceptButton: (v: boolean) => void;
  registerAcceptSuggestion: (fn: (() => void) | null) => void;
  runAcceptSuggestion: () => void;
  secondaryActionLabel: string | null;
  registerSecondaryAction: (fn: (() => void) | null, label: string | null) => void;
  runSecondaryAction: () => void;
  /** 현재 데이터로 생성된 MZ 톤 한 줄 메시지 */
  mzLine: string;
  /** 위저드 마지막 카드(제출 직전) — 오토파일럿·하이라이트 연동용 */
  wizardAwaitingFinalSubmit: boolean;
  setWizardAwaitingFinalSubmit: (v: boolean) => void;
};

const defaultInjected: CreateMeetingAgenticAiInjectedData = {
  timeSlot: 'afternoon',
  weatherMood: 'clear',
  temperatureC: 22,
  locationHint: '지하철역 근처',
  displayName: null,
  intelligentSuggestion: null,
};

const CreateMeetingAgenticAiContext = createContext<CreateMeetingAgenticAiContextValue | null>(null);

export function pickTimeSlot(now: Date = new Date()): AgenticTimeSlot {
  const h = now.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 14) return 'lunch';
  if (h >= 14 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

/** 시간대 기반 가상 날씨(시드 고정 느낌으로 단순 분기) */
export function buildVirtualWeatherForSlot(slot: AgenticTimeSlot): Pick<
  CreateMeetingAgenticAiInjectedData,
  'weatherMood' | 'temperatureC'
> {
  switch (slot) {
    case 'morning':
      return { weatherMood: 'clear', temperatureC: 18 };
    case 'lunch':
      return { weatherMood: 'cloudy', temperatureC: 24 };
    case 'afternoon':
      return { weatherMood: 'wind', temperatureC: 26 };
    case 'evening':
      return { weatherMood: 'clear', temperatureC: 21 };
    case 'night':
    default:
      return { weatherMood: 'cloudy', temperatureC: 16 };
  }
}

function weatherEmoji(m: AgenticWeatherMood): string {
  switch (m) {
    case 'clear':
      return '☀️';
    case 'cloudy':
      return '☁️';
    case 'rain':
      return '🌧️';
    case 'wind':
      return '💨';
    case 'snow':
      return '❄️';
    default:
      return '✨';
  }
}

function weatherPhrase(m: AgenticWeatherMood, t: number | null): string {
  const temp = t != null ? `${t}° 느낌` : '오늘 공기';
  switch (m) {
    case 'clear':
      return `하늘 미쳤다 ${temp}`;
    case 'cloudy':
      return `구름 많은 ${temp}인데`;
    case 'rain':
      return `비 올 수도 있는 ${temp}`;
    case 'wind':
      return `바람 살짝 도는 ${temp}`;
    case 'snow':
      return `포근 챙기기 좋은 ${temp}`;
    default:
      return temp;
  }
}

function slotGreeting(slot: AgenticTimeSlot): string {
  switch (slot) {
    case 'morning':
      return '아침부터 텐션 올려보자고 ☀️';
    case 'lunch':
      return '점심 먹고 나면 딱 모임 각이잖아요 🍚';
    case 'afternoon':
      return '오후는 살짝 졸릴 타이밍이라 모임으로 깨워버리기 ✨';
    case 'evening':
      return '퇴근 후엔 역시 사람 냄새 나는 게 최고죠 🌙';
    case 'night':
    default:
      return '야간엔 조용히 몰입 각이에요 🌃';
  }
}

/**
 * MZ 톤 + 이모지 한 줄 (비즈니스 로직은 여기만 키우면 됨).
 */
export function buildMzAgentMessage(d: CreateMeetingAgenticAiInjectedData): string {
  const loc = d.locationHint?.trim() || '이 근처';
  const wx = weatherPhrase(d.weatherMood, d.temperatureC);
  const em = weatherEmoji(d.weatherMood);
  const greet = slotGreeting(d.timeSlot);
  const nameBit = d.displayName?.trim() ? `${d.displayName.trim()}님, ` : '';

  return `${nameBit}${greet} ${wx} ${em} ${loc}니까 커피 한잔 어때요? ☕️ 지금 모임 만들면 딱일 듯! ✨`;
}

type ProviderProps = {
  children: ReactNode;
  /** 테스트·스토리북용 초기값 */
  initialData?: Partial<CreateMeetingAgenticAiInjectedData>;
};

export function CreateMeetingAgenticAiProvider({ children, initialData }: ProviderProps) {
  const [data, setData] = useState<CreateMeetingAgenticAiInjectedData>(() => {
    const slot = pickTimeSlot();
    const vw = buildVirtualWeatherForSlot(slot);
    return {
      ...defaultInjected,
      timeSlot: slot,
      ...vw,
      ...initialData,
    };
  });

  const [overrideMzLine, setOverrideMzLine] = useState<string | null>(null);
  const [hydrationStatus, setHydrationStatus] = useState<AgentHydrationStatus>('loading');
  const [coachPhase, setCoachPhase] = useState<AgentCoachPhase | null>(null);
  const [agentSnapshot, setAgentSnapshot] = useState<AgentWelcomeSnapshot | null>(null);
  const [showAcceptButton, setShowAcceptButton] = useState(false);
  const acceptRef = useRef<(() => void) | null>(null);
  const secondaryRef = useRef<(() => void) | null>(null);
  const [secondaryActionLabel, setSecondaryActionLabel] = useState<string | null>(null);
  const [wizardAwaitingFinalSubmit, setWizardAwaitingFinalSubmit] = useState(false);

  const setInjectedData = useCallback((patch: Partial<CreateMeetingAgenticAiInjectedData>) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'intelligentSuggestion')) {
      setOverrideMzLine(null);
    }
    setData((prev) => ({ ...prev, ...patch }));
  }, []);

  const setIntelligentSuggestionDirect = useCallback((text: string | null) => {
    setOverrideMzLine(text?.trim() ? text : null);
    setData((prev) => ({ ...prev, intelligentSuggestion: null }));
  }, []);

  const registerAcceptSuggestion = useCallback((fn: (() => void) | null) => {
    acceptRef.current = fn;
  }, []);

  const runAcceptSuggestion = useCallback(() => {
    acceptRef.current?.();
  }, []);

  const registerSecondaryAction = useCallback((fn: (() => void) | null, label: string | null) => {
    secondaryRef.current = fn;
    setSecondaryActionLabel(label?.trim() ? label.trim() : null);
  }, []);

  const runSecondaryAction = useCallback(() => {
    secondaryRef.current?.();
  }, []);

  const mzLine = useMemo(() => {
    if (hydrationStatus === 'loading') return '생각 중입니다…';
    const ov = overrideMzLine?.trim();
    if (ov) return ov;
    const o = data.intelligentSuggestion?.trim();
    if (o) return o;
    return buildMzAgentMessage(data);
  }, [data, hydrationStatus, overrideMzLine]);

  const value = useMemo<CreateMeetingAgenticAiContextValue>(
    () => ({
      data,
      setInjectedData,
      setIntelligentSuggestionDirect,
      hydrationStatus,
      setHydrationStatus,
      coachPhase,
      setCoachPhase,
      agentSnapshot,
      setAgentSnapshot,
      showAcceptButton,
      setShowAcceptButton,
      registerAcceptSuggestion,
      runAcceptSuggestion,
      secondaryActionLabel,
      registerSecondaryAction,
      runSecondaryAction,
      mzLine,
      wizardAwaitingFinalSubmit,
      setWizardAwaitingFinalSubmit,
    }),
    [
      data,
      setInjectedData,
      setIntelligentSuggestionDirect,
      hydrationStatus,
      coachPhase,
      agentSnapshot,
      showAcceptButton,
      registerAcceptSuggestion,
      runAcceptSuggestion,
      secondaryActionLabel,
      registerSecondaryAction,
      runSecondaryAction,
      mzLine,
      wizardAwaitingFinalSubmit,
    ],
  );

  return (
    <CreateMeetingAgenticAiContext.Provider value={value}>{children}</CreateMeetingAgenticAiContext.Provider>
  );
}

export function useCreateMeetingAgenticAi(): CreateMeetingAgenticAiContextValue {
  const ctx = useContext(CreateMeetingAgenticAiContext);
  if (!ctx) {
    throw new Error('useCreateMeetingAgenticAi must be used within CreateMeetingAgenticAiProvider');
  }
  return ctx;
}

export function useCreateMeetingAgenticAiOptional(): CreateMeetingAgenticAiContextValue | null {
  return useContext(CreateMeetingAgenticAiContext);
}
