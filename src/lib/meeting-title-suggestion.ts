/**
 * 모임 이름 AI 스타일 추천 — 카테고리·현재 시각 기반 (클라이언트 전용, 시드 조합).
 */

import type { SpecialtyKind } from './category-specialty';

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

type DescTone = 'movie' | 'food' | 'cafe' | 'sports' | 'general';

function resolveDescTone(categoryLabel: string, hasMovieTitles: boolean): DescTone {
  if (hasMovieTitles) return 'movie';
  const L = categoryLabel.trim();
  if (/영화|무비|시네마|극장|박스오피스/.test(L)) return 'movie';
  if (/맛집|식사|레스토랑|밥|먹거리|고기|회식|식당|맥주|술집|바|주점/.test(L)) return 'food';
  if (/카페|커피|디저트|차|브런치|티타임/.test(L)) return 'cafe';
  if (/운동|헬스|러닝|런닝|등산|요가|헬창|짐|스포츠|축구|농구|배드민턴|테니스|수영|클라이밍/.test(L)) return 'sports';
  return 'general';
}

const DESC_PLACEHOLDER_TAIL = '지닛이 일정·장소 조율을 도와드릴게요!';

/**
 * 모임 상세 설명 입력란 플레이스홀더 — 카테고리·특화 플로우에 맞춘 예시 한 줄 (빈 값일 때 표시).
 */
export function getFinalDescriptionPlaceholder(input: {
  categoryLabel: string;
  specialtyKind?: SpecialtyKind | null;
}): string {
  const label = input.categoryLabel.trim();
  const tail = DESC_PLACEHOLDER_TAIL;
  const sk = input.specialtyKind ?? null;

  if (sk === 'movie') {
    return `영화 보고 나서 간단히 맥주 한 잔 하실 분? ${tail}`;
  }
  if (sk === 'food') {
    return `맛집·카페에서 한 끼(또는 한 잔) 편하게 나누실 분? ${tail}`;
  }
  if (sk === 'sports') {
    return `함께 가볍게 땀 빼고 같이 쉬실 분? ${tail}`;
  }

  if (!label) {
    return `모임 분위기를 한 줄로 적어 보세요. 비우면 ${tail}`;
  }

  const tone = resolveDescTone(label, false);
  if (tone === 'movie') {
    return `영화 보고 나서 간단히 맥주 한 잔 하실 분? ${tail}`;
  }
  if (tone === 'food') {
    return `맛있는 한 끼·한 잔 편하게 나누실 분? ${tail}`;
  }
  if (tone === 'cafe') {
    return `커피 한 잔하며 이야기 나누실 분? ${tail}`;
  }
  if (tone === 'sports') {
    return `함께 움직이며 부담 없이 즐기실 분? ${tail}`;
  }
  return `「${label}」 모임, 어떤 분위기로 모이고 싶나요? 비우면 ${tail}`;
}

function descSeed(parts: { categoryLabel: string; meetingTitle: string; when: string; where: string; now: Date }): number {
  return (
    parts.now.getTime() +
    parts.categoryLabel.length * 997 +
    parts.meetingTitle.length * 131 +
    parts.when.length * 17 +
    parts.where.length * 31
  );
}

/**
 * 모임 상세 설명 자동 초안 — 카테고리 톤에 맞춰 자연스럽게 조합 (클라이언트 전용, 지닛 AI 스타일).
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
  /** 같은 입력이라도 문장이 바뀌도록(선택) */
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const label = input.categoryLabel.trim() || '모임';
  const title = input.meetingTitle.trim() || '모임';
  const where = input.placeName.trim() || '장소 미정';
  const when = `${input.scheduleDate.trim()} ${input.scheduleTime.trim()}`.trim();
  const vis = input.isPublic
    ? '공개 모임으로, 지역에서 함께할 분을 찾고 있어요.'
    : '비공개 모임으로, 초대를 통해 참여할 분을 모으고 있어요.';
  const tail = '지닛이 일정·장소 조율을 도와드릴게요.';

  const bundle = resolveCategoryBundle(label);
  const seedParts = { categoryLabel: label, meetingTitle: title, when, where, now };

  const movies = input.movieTitles?.map((s) => s.trim()).filter(Boolean) ?? [];
  const hasMovieTitles = movies.length > 0;
  const tone = resolveDescTone(label, hasMovieTitles);
  const s = descSeed(seedParts);

  if (tone === 'movie' && hasMovieTitles) {
    const head = movies.slice(0, 3).join(', ');
    const tailM = movies.length > 3 ? ` 외 ${movies.length - 3}편` : '';
    const v = s % 3;
    if (v === 0) {
      return `「${title}」은(는) 영화 모임이에요. 후보로 ${head}${tailM}을(를) 올려 두었고, 함께 볼 작품은 모임에서 가볍게 정하면 돼요. ${when} 전후로 시간을 잡았고, 모임 장소는 ${where}을(를) 기준으로 잡아 두었어요. ${vis} ${tail}`;
    }
    if (v === 1) {
      return `영화 좋아하시는 분 환영이에요. 「${title}」 모임에서는 ${head}${tailM} 중에서 보고 싶은 작품을 나눠 보려 해요. 일정은 ${when}, 장소는 ${where} 쪽으로 생각하고 있어요. ${vis} ${tail}`;
    }
    return `「${title}」 — 스크린 앞에서 만나요. 후보 작품은 ${head}${tailM}이에요. ${when}에 맞춰 오시고, 장소는 ${where}에서 모이기로 했어요. ${vis} ${tail}`;
  }

  if (tone === 'movie' && !hasMovieTitles) {
    const v = s % 2;
    if (v === 0) {
      return `「${title}」은(는) 영화 모임이에요. 보고 싶은 작품은 모임에서 천천히 정해도 괜찮아요. ${when} 전후로 시간을 잡았고, 장소는 ${where}을(를) 생각해 두었어요. ${vis} ${tail}`;
    }
    return `영화 한 편 같이 보실 분을 모아요. 「${title}」 모임은 ${when}에 가볍게 모일 예정이에요. 장소는 ${where}에서 만나려고 해요. ${vis} ${tail}`;
  }

  if (tone === 'food') {
    const v = s % 3;
    if (v === 0) {
      return `「${title}」 — ${label} 모임이에요. ${when}에 ${where}에서 모여 ${bundle.noun} 이야기와 맛집 수다를 나누려고 해요. 부담 없이 한 끼(또는 한 잔) 즐기면 좋겠어요. ${vis} ${tail}`;
    }
    if (v === 1) {
      return `${label} 좋아하시는 분, 「${title}」에 참여해 보세요. ${when}에 ${where}에서 만나 맛·메뉴 이야기부터 천천히 나눌 생각이에요. ${vis} ${tail}`;
    }
    return `「${title}」 모임은 ${label}에 맞춰 ${when}에 잡아 두었어요. 장소는 ${where}이고, 부담 없이 한 끼(또는 한 잔) 나누면 좋겠어요. ${vis} ${tail}`;
  }

  if (tone === 'cafe') {
    const v = s % 3;
    if (v === 0) {
      return `「${title}」 — ${label} 모임이에요. ${when}에 ${where}에서 천천히 이야기 나누려고 해요. 조용히 쉬었다 가도 좋고, 수다 삼매경이어도 좋아요. ${vis} ${tail}`;
    }
    if (v === 1) {
      return `커피 한 잔 하며 수다 나누실 분, 「${title}」에 와 주세요. ${when}, ${where}에서 만나려고 해요. ${vis} ${tail}`;
    }
    return `「${title}」은(는) ${label} 모임이에요. ${when} 전후로 시간을 잡았고, 장소는 ${where}예요. 일정이 바뀌어도 지닛으로 천천히 맞춰 가면 돼요. ${vis} ${tail}`;
  }

  if (tone === 'sports') {
    const v = s % 3;
    if (v === 0) {
      return `「${title}」 — ${label} 모임이에요. ${when}에 ${where}에서 모여 ${bundle.noun} 한판(또는 한 세션) 즐기려고 해요. 페이스는 모임에서 가볍게 맞추면 좋겠어요. ${vis} ${tail}`;
    }
    if (v === 1) {
      return `함께 움직이고 싶은 분, 「${title}」에 참여해 보세요. ${when}, ${where}에서 만나려고 해요. 준비물·강도는 모임에서 가볍게 나눌게요. ${vis} ${tail}`;
    }
    return `「${title}」 모임은 ${label}에 맞춰 ${when}에 잡아 두었어요. 장소는 ${where}이에요. 처음 오셔도 부담 없이 따라오실 수 있게 할게요. ${vis} ${tail}`;
  }

  const v = s % 3;
  if (v === 0) {
    return `「${title}」은(는) ${label} 모임이에요. ${when}에 ${where}에서 만나려고 해요. 처음 뵙는 분도 편하게 오실 수 있게 할게요. ${vis} ${tail}`;
  }
  if (v === 1) {
    return `${label} 모임 「${title}」이에요. ${when} 전후로 시간을 잡았고, 장소는 ${where}예요. 편한 마음으로 오시면 돼요. ${vis} ${tail}`;
  }
  return `「${title}」 — ${label} 주제로 가볍게 모이려고 해요. ${when}에 ${where}에서 만날 예정이에요. ${vis} ${tail}`;
}
