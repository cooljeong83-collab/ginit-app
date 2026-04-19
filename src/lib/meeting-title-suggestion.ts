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
 * `variantSalt`가 다르면 같은 시각·카테고리에서도 다른 문구가 나오도록 시드를 바꿉니다.
 */
export function generateSuggestedMeetingTitle(
  categoryLabel: string,
  now: Date = new Date(),
  variantSalt = 0,
): string {
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
    label.length * 997 +
    variantSalt * 7919;

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

const TITLE_VARIANT_PRIMES = [0, 17, 41, 73, 101, 137, 163] as const;

/**
 * 같은 카테고리·시각 기준으로 서로 다른 추천 제목을 여러 개 만듭니다 (중복 제거).
 */
export function generateSuggestedMeetingTitles(
  categoryLabel: string,
  now: Date = new Date(),
  count = 4,
): string[] {
  const label = categoryLabel.trim();
  if (!label) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const salt of TITLE_VARIANT_PRIMES) {
    if (out.length >= count) break;
    const t = generateSuggestedMeetingTitle(label, now, salt).trim();
    if (t.length === 0 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  let extra = 200;
  while (out.length < count && extra < 5000) {
    const t = generateSuggestedMeetingTitle(label, now, extra).trim();
    if (t.length > 0 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
    extra += 31;
  }
  return out.slice(0, count);
}

/**
 * 모임 상세 설명 자동 초안 — 네트워크 없이 제목·카테고리·일정·장소 등을 조합 (지닛 AI 스타일).
 * 사용자가 설명을 비워 둔 경우 등록 시 채워 넣기 위해 사용합니다.
 */
export function generateAiMeetingDescription(input: {
  categoryLabel: string;
  meetingTitle: string;
  placeName: string;
  scheduleDate: string;
  scheduleTime: string;
  /** 영화 모임이면 후보 제목(일부) */
  movieTitles?: string[];
  isPublic: boolean;
}): string {
  const cat = input.categoryLabel.trim() || '모임';
  const title = input.meetingTitle.trim() || '모임';
  const where = input.placeName.trim() || '장소 미정';
  const when = `${input.scheduleDate.trim()} ${input.scheduleTime.trim()}`.trim();
  const vis = input.isPublic
    ? '공개 모임으로, 지역에서 함께할 분을 찾고 있어요.'
    : '비공개 모임으로, 초대를 통해 참여할 분을 모으고 있어요.';

  const movies = input.movieTitles?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (movies.length > 0) {
    const head = movies.slice(0, 3).join(', ');
    const tail = movies.length > 3 ? ` 외 ${movies.length - 3}편` : '';
    return `「${title}」 영화 모임이에요. 후보로 ${head}${tail}을(를) 두었고, 함께 볼 작품은 모임에서 정하면 돼요. 일정은 ${when} 전후로 잡아 두었고 장소는 ${where}예요. ${vis} 지닛이 시간·장소 조율을 도와드릴게요!`;
  }

  return `「${title}」(${cat}) 모임이에요. ${when}에 ${where}에서 만나려고 해요. ${vis} 편하게 참여해 주시고, 지닛이 일정·장소 맞추기를 도와드릴게요!`;
}
