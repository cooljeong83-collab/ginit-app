import type { Meeting } from '@/src/lib/meetings';
import type { UserProfile } from '@/src/lib/user-profile';

/** 로컬 시간대 기준 슬롯 — `CreateMeetingAgenticAiContext`와 동일 규칙 */
export type AgentTimeSlot = 'morning' | 'lunch' | 'afternoon' | 'evening' | 'night';

export type AgentWeatherMood = 'clear' | 'cloudy' | 'rain' | 'wind' | 'snow';

export type AgentHydrationStatus = 'idle' | 'loading' | 'ready' | 'error';

export type AgentCoachPhase =
  | 'tab_greeting'
  | 'details_pattern_suggest'
  | 'details_step3_capacity'
  | 'details_step4_schedule'
  | 'details_step5_place_suggest'
  | 'details_step6_optional';

export type RecentMeetingsSummary = {
  topCategoryLabels: string[];
  lastTitle: string | null;
  meetingCountSample: number;
};

export type FrequentPlaceSummary = {
  /** 표시용 한 줄 (예: "강남역 카페") */
  displayQuery: string;
  /** 검색에 넣을 쿼리 */
  searchQuery: string;
  hitCount: number;
};

export type OngoingMeetingsChatHint = {
  count: number;
  /** 채팅 라우트용 id (Firestore 문서 id 우선) */
  nearestMeetingId: string | null;
  nearestTitle: string | null;
};

export type AgentWelcomeSnapshot = {
  now: Date;
  timeSlot: AgentTimeSlot;
  displayName: string | null;
  gDnaChips: string[];
  profileMeetingCount: number | null;
  locationHint: string | null;
  weatherMood: AgentWeatherMood;
  temperatureC: number | null;
  recentMeetings: Meeting[];
  recentSummary: RecentMeetingsSummary | null;
  ongoingChatHint: OngoingMeetingsChatHint;
  /** 원본 프로필(선택 필드만 쓰지 않아도 됨) */
  profile: UserProfile | null;
};

export type WizardSuggestion = {
  categoryId: string;
  categoryLabel: string;
  /** food 전용 — `MenuPreference` OPTIONS 중 하나 */
  menuPreferenceLabel: string | null;
  /** 자동 완료 가능 여부(식사·세부 없음) */
  canAutoCompleteThroughStep3: boolean;
};

export type StepCoachInput = {
  phase: AgentCoachPhase;
  snapshot: AgentWelcomeSnapshot | null;
  /** Step 4: 첫 일시 요약 */
  firstScheduleSummary?: string | null;
  /** Step 5: 빈도 장소 */
  frequentPlace?: FrequentPlaceSummary | null;
};
