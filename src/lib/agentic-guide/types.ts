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

/** 집계된 장소 후보(검색 힌트·멘트용) */
export type WeightedPlaceHit = {
  displayQuery: string;
  searchQuery: string;
  score: number;
};

/** 참여 모임 기반 습관 집계 — `loadWelcomeSnapshot`에서 기록 있을 때만 채움 */
export type UserMeetingHabitsAggregate = {
  sampledMeetingCount: number;
  /** 0~1, 주말(토·일) 일정 비중 */
  weekendDayPortion: number | null;
  /** 주말 일정만 모은 카테고리 라벨 최빈 */
  weekendTopCategoryLabel: string | null;
  weekendTopCategoryCount: number;
  /** 0~1, 짧은 간격(번개) 성향 추정 */
  lightningScore: number | null;
  /** 최근 롤링 주당 평균 참여 건수 */
  meetingsPerWeekAvg: number | null;
  /** 가중 상위 장소 */
  topPlaces: WeightedPlaceHit[];
  /** 다가오는 가장 가까운 토요일 YYYY-MM-DD (로컬) */
  nextSaturdayYmd: string | null;
  /** extra_data.fs 병합으로 투표·후보가 채워진 비율 0~1 */
  dataCompletenessFsShare: number;
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
  /** 참여 기록이 있을 때만 */
  meetingHabits: UserMeetingHabitsAggregate | null;
};

export type WizardSuggestion = {
  categoryId: string;
  categoryLabel: string;
  /** food 전용 — `MenuPreference` OPTIONS 중 하나 */
  menuPreferenceLabel: string | null;
  /** 자동 완료 가능 여부(식사·세부 없음) */
  canAutoCompleteThroughStep3: boolean;
  /** Step 5 등 — 집계 기반 장소 검색 힌트 */
  placeSearchHint: string | null;
  /** 에이전트 수락 시 공개 여부(null이면 UI만 펄스·상태 유지) */
  suggestedIsPublic?: boolean | null;
};

export type StepCoachInput = {
  phase: AgentCoachPhase;
  snapshot: AgentWelcomeSnapshot | null;
  /** Step 4: 첫 일시 요약 */
  firstScheduleSummary?: string | null;
  /** Step 5: 빈도 장소 */
  frequentPlace?: FrequentPlaceSummary | null;
  /** Step 5~6: 집계(멘트 보강) */
  meetingHabits?: UserMeetingHabitsAggregate | null;
};
