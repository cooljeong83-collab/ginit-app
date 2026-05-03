import type { AgentTimeSlot, AgentWeatherMood, AgentWelcomeSnapshot } from '@/src/lib/agentic-guide/types';

const WEEKDAY_KO = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;

function timeSlotLabelKo(slot: AgentTimeSlot): string {
  switch (slot) {
    case 'morning':
      return '아침';
    case 'lunch':
      return '점심';
    case 'afternoon':
      return '오후';
    case 'evening':
      return '저녁';
    case 'night':
      return '밤';
    default:
      return '오늘';
  }
}

/** 예: `일요일 저녁` — 시·분은 인삿말에 넣지 않음 */
export function formatKoWeekdaySlot(now: Date, timeSlot: AgentTimeSlot): string {
  const wd = WEEKDAY_KO[now.getDay()] ?? '오늘';
  const slotKo = timeSlotLabelKo(timeSlot);
  return `${wd} ${slotKo}`;
}

/** 문장용 짧은 날씨 무드 */
export function weatherMoodShortKo(mood: AgentWeatherMood): string {
  switch (mood) {
    case 'clear':
      return '맑게 감 잡히는';
    case 'cloudy':
      return '살짝 흐린';
    case 'rain':
      return '비가 올 법한';
    case 'wind':
      return '바람이 살짝 도는';
    case 'snow':
      return '포근하게 가라앉은';
    default:
      return '오늘만 같은';
  }
}

export function locationLineKo(locationHint: string | null | undefined): string {
  const t = locationHint?.trim();
  if (t && t.length > 0) return t;
  return '이 근처';
}

/** 첫 문장 직후 — 날씨·시간대 기준 결정적 선택 */
function moodLeadEmoji(mood: AgentWeatherMood, timeSlot: AgentTimeSlot): string {
  if (timeSlot === 'night') return '🌙';
  switch (mood) {
    case 'cloudy':
      return '☁️';
    case 'clear':
      return '✨';
    case 'rain':
      return '🔮';
    case 'wind':
      return '☁️';
    case 'snow':
      return '✨';
    default:
      return '✨';
  }
}

function isWeekend(now: Date): boolean {
  const d = now.getDay();
  return d === 0 || d === 6;
}

export type Step1GreetingParts = {
  now: Date;
  displayName: string | null;
  locationHint: string | null;
  weatherMood: AgentWeatherMood;
  timeSlot: AgentTimeSlot;
};

/**
 * 모임 생성 스텝1 첫 말풍선 — 이름·시각·위치·날씨 무드 + 대화/직접 생성 안내(최대 3문장).
 * 스냅샷 없이 부트스트랩 에러 시 `buildStep1ConversationalGreetingFromParts` 사용.
 */
export function buildStep1ConversationalGreetingFromParts(p: Step1GreetingParts): string {
  const name = p.displayName?.trim();
  const prefix = name ? `${name}님, ` : '안녕하세요, ';
  const when = formatKoWeekdaySlot(p.now, p.timeSlot);
  const loc = locationLineKo(p.locationHint);
  const wx = weatherMoodShortKo(p.weatherMood);
  const e1 = moodLeadEmoji(p.weatherMood, p.timeSlot);

  const s1 = `${prefix}${when} ${loc}는 지금 ${wx} 무드네요. ${e1}`;
  const s2 = isWeekend(p.now)
    ? '남은 주말을 기분 좋게 채워줄 모임, 저랑 대화로 짜 드릴까요?'
    : '오늘 같은 흐름이면, 저랑 대화로 모임 초안을 같이 짜 볼까요?';
  const s3 = '편하게 말씀해 주셔도 좋고 직접 만드셔도 돼요! ✨';

  return `${s1} ${s2} ${s3}`;
}

export function buildStep1ConversationalGreetingMessage(snapshot: AgentWelcomeSnapshot): string {
  return buildStep1ConversationalGreetingFromParts({
    now: snapshot.now,
    displayName: snapshot.displayName,
    locationHint: snapshot.locationHint,
    weatherMood: snapshot.weatherMood,
    timeSlot: snapshot.timeSlot,
  });
}
