/**
 * 모임 이름 AI 스타일 추천 — 카테고리·현재 시각 기반 (클라이언트 전용, 시드 조합).
 */

import { isPcGameMajorCode, isPlayAndVibeMajorCode, type SpecialtyKind } from './category-specialty';

const FRIDAY_MOODS = ['불금', '드디어 금요일'];
const MORNING_LUNCH_MOODS = ['활기찬', '브런치', '상쾌한'];
const EVENING_NIGHT_MOODS = ['불타는', '무드 있는', '하루를 마무리하는'];

const DAY_NAMES_KO = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

const LAZY_SLOT_MOODS = ['나른한', '여유로운', '산뜻한', '느긋한', '포근한'] as const;

export type MeetingTitleSuggestionContext = {
  /** 행정구 등 (예: 영등포구) */
  regionLabel?: string | null;
  /** 날씨 기반 짧은 수식 (예: 맑은, 비 오는·쌀쌀한) */
  weatherMood?: string | null;
  /** `meeting_categories.major_code` — 대분류 톤·시드 */
  majorCode?: string | null;
  /** Step2 특화 종류(영화·맛집·운동·지식 등) */
  specialtyKind?: SpecialtyKind | null;
  /** 영화 Step2 — 선택한 후보 제목들 */
  movieTitles?: readonly string[] | null;
  /** Eat & Drink Step2 — 메뉴 성향 칩 */
  menuPreferences?: readonly string[] | null;
  /** Active & Life Step2 — 활동 종류 칩 */
  activityKinds?: readonly string[] | null;
  /** Play & Vibe Step2 — 게임 종류 칩 */
  gameKinds?: readonly string[] | null;
  /** Focus & Knowledge Step2 — 모임 성격 칩 */
  focusKnowledgePreferences?: readonly string[] | null;
};

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
  if (/스터디|북카페|강연|세미나|토론|학습|카공|코워킹|워크숍|자격증|북클럽|독서/.test(L)) {
    return { noun: '학습 모임', keywords: ['집중', '카공', '나눔'] };
  }
  const noun = L.length > 10 ? `${L.slice(0, 10)}…` : L;
  return { noun: noun || '모임', keywords: ['번개', '한판', '모여'] };
}

function pick<T>(arr: readonly T[], salt: number): T {
  if (arr.length === 0) throw new Error('empty pick');
  const i = Math.abs(salt) % arr.length;
  return arr[i]!;
}

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

function truncateNoun(s: string, max = 14): string {
  const t = s.trim();
  if (!t) return '모임';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function uniqKeywords(...groups: readonly string[][]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    for (const x of g) {
      const t = String(x ?? '').trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out.slice(0, 5);
}

/** `major_code`가 라벨보다 먼저일 때도 톤을 보강 */
function mergeMajorCodeHints(majorCode: string | null | undefined, b: CategoryBundle): CategoryBundle {
  const mc = (majorCode ?? '').trim().toLowerCase();
  if (!mc) return b;
  if (mc === 'eat & drink') {
    return { ...b, keywords: uniqKeywords(['한 끼', '수다'], b.keywords) };
  }
  if (mc === 'active & life') {
    return { ...b, keywords: uniqKeywords(['크루', '모여'], b.keywords) };
  }
  if (mc === 'play & vibe') {
    return { ...b, keywords: uniqKeywords(['번개', '한판'], b.keywords) };
  }
  if (mc === 'pcgame') {
    return { ...b, keywords: uniqKeywords(['PC방', '듀오'], b.keywords) };
  }
  if (mc === 'focus & knowledge') {
    const noun = b.noun === '모임' ? '학습 모임' : b.noun;
    return { noun, keywords: uniqKeywords(['집중', '나눔'], b.keywords) };
  }
  return b;
}

function resolveCategoryBundleFromContext(label: string, ctx?: MeetingTitleSuggestionContext): CategoryBundle {
  const base = resolveCategoryBundle(label);
  if (!ctx?.specialtyKind) {
    return mergeMajorCodeHints(ctx?.majorCode, base);
  }

  const sk = ctx.specialtyKind;
  const mt = (ctx.movieTitles ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  const mp = (ctx.menuPreferences ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  const ak = (ctx.activityKinds ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  const gk = (ctx.gameKinds ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  const fk = (ctx.focusKnowledgePreferences ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);

  let out: CategoryBundle;
  if (sk === 'movie' && mt.length > 0) {
    const h = hashString(mt.join('|'));
    out = {
      noun: truncateNoun(mt[0]!, 14),
      keywords: ['관람', '토크', pick(['극장', '스크린'], h)],
    };
  } else if (sk === 'food' && mp.length > 0) {
    out = { noun: truncateNoun(mp[0]!, 10), keywords: uniqKeywords(mp, base.keywords) };
  } else if (sk === 'sports' && isPlayAndVibeMajorCode(ctx.majorCode) && gk.length > 0) {
    const first = gk[0]!;
    const short = first.includes('·') ? first.split('·')[0]!.trim() : first;
    out = {
      noun: truncateNoun(short || '게임', 10),
      keywords: uniqKeywords(gk, ['한판', '파티']),
    };
  } else if (sk === 'sports' && isPcGameMajorCode(ctx.majorCode) && gk.length > 0) {
    const first = gk[0]!;
    out = {
      noun: truncateNoun(first || 'PC 게임', 12),
      keywords: uniqKeywords(gk, ['PC방', '랭크']),
    };
  } else if (sk === 'sports' && ak.length > 0) {
    const first = ak[0]!;
    const short = first.includes('·') ? first.split('·')[0]!.trim() : first;
    out = {
      noun: truncateNoun(short || base.noun, 10) || base.noun,
      keywords: uniqKeywords(ak, base.keywords),
    };
  } else if (sk === 'knowledge' && fk.length > 0) {
    out = { noun: truncateNoun(fk[0]!, 12), keywords: uniqKeywords([...fk, '모각', '집중'], []) };
  } else {
    out = base;
  }
  return mergeMajorCodeHints(ctx.majorCode, out);
}

function resolveActivityPhraseFromContext(label: string, cat: CategoryBundle, ctx?: MeetingTitleSuggestionContext): string {
  const sk = ctx?.specialtyKind;
  if (sk === 'movie' && ctx?.movieTitles?.length) {
    const t = String(ctx.movieTitles[0] ?? '').trim();
    if (t) return `${truncateNoun(t, 18)} 보기`;
  }
  if (sk === 'food' && ctx?.menuPreferences?.length) {
    const m = String(ctx.menuPreferences[0] ?? '').trim();
    if (m) return `${m}로 한 끼`;
  }
  if (sk === 'sports' && isPlayAndVibeMajorCode(ctx?.majorCode) && ctx?.gameKinds?.length) {
    const g = String(ctx.gameKinds[0] ?? '').trim();
    if (g) return `${g} 한 판`;
  }
  if (sk === 'sports' && isPcGameMajorCode(ctx?.majorCode) && ctx?.gameKinds?.length) {
    const g = String(ctx.gameKinds[0] ?? '').trim();
    if (g) return `${g} 같이`;
  }
  if (sk === 'sports' && ctx?.activityKinds?.length) {
    const a = String(ctx.activityKinds[0] ?? '').trim();
    if (a) return `${a} 같이`;
  }
  if (sk === 'knowledge' && ctx?.focusKnowledgePreferences?.length) {
    const f = String(ctx.focusKnowledgePreferences[0] ?? '').trim();
    if (f) return `${f} 모여`;
  }
  return resolveActivityPhrase(label, cat);
}

function flavorSeed(ctx?: MeetingTitleSuggestionContext): number {
  if (!ctx) return 0;
  const key = [
    (ctx.majorCode ?? '').trim(),
    ctx.specialtyKind ?? '',
    (ctx.movieTitles ?? []).join('|'),
    (ctx.menuPreferences ?? []).join('|'),
    (ctx.activityKinds ?? []).join('|'),
    (ctx.gameKinds ?? []).join('|'),
    (ctx.focusKnowledgePreferences ?? []).join('|'),
  ].join('\u001f');
  return hashString(key) % 499_979;
}

/** 지역·날씨 문맥에 맞는 한 줄 활동 문구 */
function resolveActivityPhrase(label: string, cat: CategoryBundle): string {
  const L = label.trim();
  if (/카페|커피|디저트|차|브런치/.test(L)) return '커피 한잔';
  if (/맛집|식사|레스토랑|밥|먹거리|고기|회식|식당|술|맥주|바|주점/.test(L)) return '맛있는 한 끼';
  if (/영화|무비|시네마|극장/.test(L)) return '영화 한 편';
  if (/산책|공원/.test(L)) return '산책';
  if (/운동|헬스|러닝|런닝|등산|요가|짐|스포츠/.test(L)) return '가볍게 운동';
  if (/전시|미술|공연|문화/.test(L)) return '전시 한번';
  if (/스터디|북카페|강연|세미나|토론|학습|카공|코워킹|워크숍|자격증|북클럽|독서/.test(L)) return '함께 집중해서 배우기';
  return `${cat.noun} 한번`;
}

/** 날씨 문구만 있을 때 — 지역 없이 캐주얼 톤 */
function pickAmbientFromWeather(weather: string, seed: number): string {
  const wx = weather.trim();
  if (/비|이슬|소나기|눈|천둥|번개/.test(wx)) return pick(['우중충한', '촉촉한', '스산한'], seed);
  if (/흐린|구름/.test(wx)) return pick(['우중충한', '잔잔한', '답답 풀리는'], seed);
  if (/맑은|대체로 맑은/.test(wx)) return pick(['산뜻한', '맑은', '상큼한'], seed);
  if (/무더운|따뜻한/.test(wx)) return pick(['따뜻한', '나른한', '느긋한'], seed);
  if (/추운|한파|쌀쌀|매우 추운/.test(wx)) return pick(['쌀쌀한', '포근한', '따뜻한'], seed);
  if (/안개/.test(wx)) return pick(['몽환적인', '잔잔한'], seed);
  return pick(['여유로운', '나른한', '산뜻한'], seed);
}

function buildWeatherOnlyCasualTitle(input: {
  cat: CategoryBundle;
  weather: string;
  seed: number;
  dow: number;
  h: number;
  slotWord: string;
  morningMood: string;
  eveningMood: string;
  catKw: string;
  activityPhrase: string;
}): string {
  const { cat, weather, seed, dow, h, slotWord, morningMood, eveningMood, catKw, activityPhrase: activity } = input;
  const ambient = pickAmbientFromWeather(weather, seed);
  const dayName = DAY_NAMES_KO[dow];
  const wx = weather.trim();
  const p = seed % 7;
  if (p === 0) return `${ambient} ${slotWord} ${activity} 어때요?`;
  if (p === 1) return `${wx} ${slotWord} ${activity} 어때요?`;
  if (p === 2) return `${dayName} ${wx} ${slotWord}, ${activity} 어때요?`;
  if (p === 3) return `${ambient} ${slotWord} ${cat.noun} ${catKw} 어때요?`;
  if (p === 4) return `${wx} 기분으로 ${activity} 어때요?`;
  const mood = h >= 6 && h < 14 ? morningMood : h >= 17 || h < 5 ? eveningMood : pick([...MORNING_LUNCH_MOODS, ...EVENING_NIGHT_MOODS], seed + 3);
  return `${mood} ${slotWord} ${activity} 어때요?`;
}

/** 위치·날씨 모두 없을 때(또는 아직 로딩 전) — 캐주얼 톤 */
function buildNoGeoCasualTitle(input: {
  cat: CategoryBundle;
  seed: number;
  dow: number;
  h: number;
  slotWord: string;
  morningMood: string;
  eveningMood: string;
  catKw: string;
  activityPhrase: string;
}): string {
  const { cat, seed, dow, h, slotWord, morningMood, eveningMood, catKw, activityPhrase: activity } = input;
  const lazy = pick(LAZY_SLOT_MOODS, seed + 41);
  const dayName = DAY_NAMES_KO[dow];
  const p = seed % 7;
  if (p === 0) return `${lazy} ${slotWord} ${activity} 어때요?`;
  if (p === 1) return `${dayName} ${slotWord} ${activity} 어때요?`;
  if (p === 2) return `${lazy} ${slotWord} ${cat.noun} ${catKw} 어때요?`;
  if (p === 3) return `${slotWord}엔 ${activity} 어때요?`;
  if (p === 4) return `${dayName} ${cat.noun} ${catKw} 어때요?`;
  const mood = h >= 6 && h < 14 ? morningMood : h >= 17 || h < 5 ? eveningMood : pick([...MORNING_LUNCH_MOODS, ...EVENING_NIGHT_MOODS], seed + 9);
  return `${mood} ${slotWord} ${activity} 어때요?`;
}

function buildLocationAwareTitle(input: {
  cat: CategoryBundle;
  region: string;
  weather: string;
  seed: number;
  dow: number;
  h: number;
  slotWord: string;
  morningMood: string;
  eveningMood: string;
  catKw: string;
  activityPhrase: string;
}): string {
  const { cat, region, weather, seed, dow, h, slotWord, morningMood, eveningMood, catKw, activityPhrase: activity } = input;
  const dayName = DAY_NAMES_KO[dow];
  const wx = weather.trim();
  const wxLead = wx ? `${wx} ` : '';
  const lazy = pick(LAZY_SLOT_MOODS, seed + 41);
  const p = seed % 9;

  if (dow === 5 && p === 0) {
    return `${pick(FRIDAY_MOODS, seed + 5)} ${region}에서 ${activity}`;
  }
  if (p === 0) return `${lazy} ${slotWord} ${region}에서 ${activity}`;
  if (p === 1) return `${wxLead}${slotWord} ${region}에서 ${activity}`;
  if (p === 2) return `${dayName}, ${region} ${cat.noun} ${catKw}`;
  if (p === 3) return `${region} ${slotWord} ${activity}`;
  if (p === 4) return `${wxLead}${region}에서 ${cat.noun} ${catKw}`;
  if (p === 5) return `${dayName} ${region}에서 ${activity}`;
  if (p === 6) return `${region} 근처 ${cat.noun} ${catKw}`;
  if (p === 7) return `${wxLead}${dayName} ${region} ${cat.noun} ${catKw}`;
  const mood = h >= 6 && h < 14 ? morningMood : h >= 17 || h < 5 ? eveningMood : pick([...MORNING_LUNCH_MOODS, ...EVENING_NIGHT_MOODS], seed + 7);
  return `${mood} ${region} ${slotWord} ${catKw}`;
}

/**
 * `categoryLabel`(Firestore 카테고리 표시명)과 `now`로 한 줄 추천 제목을 만듭니다.
 * `variantSalt`가 다르면 같은 시각·카테고리에서도 다른 문구가 나오도록 시드를 바꿉니다.
 */
export function generateSuggestedMeetingTitle(
  categoryLabel: string,
  now: Date = new Date(),
  variantSalt = 0,
  ctx?: MeetingTitleSuggestionContext,
): string {
  const label = categoryLabel.trim() || '모임';
  const cat = resolveCategoryBundleFromContext(label, ctx);
  const activityPhrase = resolveActivityPhraseFromContext(label, cat, ctx);
  const h = now.getHours();
  const dow = now.getDay();
  const seed =
    now.getFullYear() * 10000 +
    (now.getMonth() + 1) * 100 +
    now.getDate() +
    now.getHours() * 60 +
    now.getMinutes() +
    label.length * 997 +
    variantSalt * 7919 +
    flavorSeed(ctx);

  const slotWord =
    h >= 5 && h < 11 ? '아침' : h >= 11 && h < 14 ? '점심' : h >= 14 && h < 17 ? '오후' : h >= 17 && h < 22 ? '저녁' : '밤';

  const morningMood = pick(MORNING_LUNCH_MOODS, seed);
  const eveningMood = pick(EVENING_NIGHT_MOODS, seed + 11);
  const catKw = pick(cat.keywords, seed + 23);

  const region = (ctx?.regionLabel ?? '').trim();
  const weather = (ctx?.weatherMood ?? '').trim();

  if (region.length > 0) {
    return buildLocationAwareTitle({
      cat,
      region,
      weather,
      seed,
      dow,
      h,
      slotWord,
      morningMood,
      eveningMood,
      catKw,
      activityPhrase,
    });
  }

  if (weather.length > 0) {
    return buildWeatherOnlyCasualTitle({
      cat,
      weather,
      seed,
      dow,
      h,
      slotWord,
      morningMood,
      eveningMood,
      catKw,
      activityPhrase,
    });
  }

  /** 약속 잡기 화면 등: 컨텍스트 객체는 있으나 위치·날씨 없음 → 오류 표시 없이 가벼운 추천만 */
  if (ctx !== undefined) {
    return buildNoGeoCasualTitle({
      cat,
      seed,
      dow,
      h,
      slotWord,
      morningMood,
      eveningMood,
      catKw,
      activityPhrase,
    });
  }

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
  ctx?: MeetingTitleSuggestionContext,
): string[] {
  const label = categoryLabel.trim();
  if (!label) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const salt of TITLE_VARIANT_PRIMES) {
    if (out.length >= count) break;
    const t = generateSuggestedMeetingTitle(label, now, salt, ctx).trim();
    if (t.length === 0 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  let extra = 200;
  while (out.length < count && extra < 5000) {
    const t = generateSuggestedMeetingTitle(label, now, extra, ctx).trim();
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
  if (sk === 'knowledge') {
    return `함께 배우고 나누며 집중할 분? ${tail}`;
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
