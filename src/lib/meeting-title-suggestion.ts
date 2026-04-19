/**
 * 모임 이름 AI 스타일 추천 — 카테고리·현재 시각 기반 (클라이언트 전용, 시드 조합).
 */

const FRIDAY_MOODS = ['불금', '드디어 금요일'];
const MORNING_LUNCH_MOODS = ['활기찬', '브런치', '상쾌한'];
const EVENING_NIGHT_MOODS = ['불타는', '무드 있는', '하루를 마무리하는'];

const DAY_NAMES_KO = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

type CategoryBundle = { noun: string; keywords: string[] };

function resolveCategoryBundle(label: string): CategoryBundle {
  const L = label.trim();
  if (/맛집|식사|레스토랑|밥|먹거리|고기|회식|식당/.test(L)) {
    return { noun: '맛집', keywords: ['정복', '탐방', '먹부림'] };
  }
  if (/카페|커피|디저트|차|브런치/.test(L)) {
    return { noun: '카페', keywords: ['카공', '수다', '티타임'] };
  }
  if (/운동|헬스|러닝|런닝|등산|요가|헬창|짐/.test(L)) {
    return { noun: '운동', keywords: ['오운완', '크루', '버닝'] };
  }
  const noun = L.length > 10 ? `${L.slice(0, 10)}…` : L;
  return { noun: noun || '모임', keywords: ['번개', '한판', '모여'] };
}

function pick<T>(arr: readonly T[], salt: number): T {
  if (arr.length === 0) throw new Error('empty pick');
  const i = Math.abs(salt) % arr.length;
  return arr[i]!;
}

/**
 * `categoryLabel`(Firestore 카테고리 표시명)과 `now`로 한 줄 추천 제목을 만듭니다.
 */
export function generateSuggestedMeetingTitle(categoryLabel: string, now: Date = new Date()): string {
  const label = categoryLabel.trim() || '모임';
  const cat = resolveCategoryBundle(label);
  const h = now.getHours();
  const dow = now.getDay();
  const seed =
    now.getFullYear() * 10000 +
    (now.getMonth() + 1) * 100 +
    now.getDate() +
    now.getHours() * 60 +
    now.getMinutes() +
    label.length * 997;

  const slotWord =
    h >= 5 && h < 11 ? '아침' : h >= 11 && h < 14 ? '점심' : h >= 14 && h < 17 ? '오후' : h >= 17 && h < 22 ? '저녁' : '밤';

  const morningMood = pick(MORNING_LUNCH_MOODS, seed);
  const eveningMood = pick(EVENING_NIGHT_MOODS, seed + 11);
  const catKw = pick(cat.keywords, seed + 23);

  if (dow === 5) {
    const fri = pick(FRIDAY_MOODS, seed + 5);
    const variant = seed % 3;
    if (variant === 0) {
      return `${fri} ${cat.noun} ${catKw}`;
    }
    if (variant === 1) {
      const mood = h >= 6 && h < 14 ? morningMood : eveningMood;
      return `${fri} ${mood} ${cat.noun} ${catKw}`;
    }
    return `${DAY_NAMES_KO[dow]} ${slotWord}의 ${cat.noun} ${catKw}`;
  }

  const dayName = DAY_NAMES_KO[dow];
  const variant = seed % 3;
  if (variant === 0) {
    return `${dayName} ${slotWord}의 ${cat.noun} ${catKw}`;
  }
  if (variant === 1) {
    const mood = h >= 6 && h < 14 ? morningMood : h >= 17 || h < 5 ? eveningMood : pick([...MORNING_LUNCH_MOODS, ...EVENING_NIGHT_MOODS], seed + 7);
    return `${mood} ${cat.noun} ${catKw}`;
  }
  const mood = h >= 6 && h < 14 ? morningMood : eveningMood;
  return `${dayName} ${mood} ${cat.noun} ${catKw}`;
}
