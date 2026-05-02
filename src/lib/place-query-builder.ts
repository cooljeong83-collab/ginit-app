/**
 * 모임 생성 장소 단계 — 네이버 지역 검색용 시드 문자열 생성 (클라이언트 전용).
 * 일정(요일·시간대)·인원·카테고리·구역 bias 반영. 날씨는 사용하지 않음.
 */

import { CAPACITY_UNLIMITED } from '@/components/create/GlassDualCapacityWheel';
import {
  isActiveLifeMajorCode,
  isPcGameMajorCode,
  isPlayAndVibeMajorCode,
  resolveSpecialtyKind,
  type SpecialtyKind,
} from '@/src/lib/category-specialty';

const PARTICIPANT_MIN_FALLBACK = 2;

export type PlaceQueryScheduleInput = {
  startDate: string;
  startTime?: string;
};

export type PlaceQueryBuilderInput = {
  bias: string | null | undefined;
  categoryLabel: string;
  schedule: PlaceQueryScheduleInput | null | undefined;
  minParticipants?: number;
  maxParticipants?: number;
  /** 있으면 `categoryLabel` 정규식 대신 사용( `major_code` 기반 특화와 정합 ) */
  specialtyKind?: SpecialtyKind | null;
  /**
   * Eat & Drink 등 메뉴 성향 Step에서 고른 값(예: 한식·카페·디저트).
   * `specialtyKind === 'food'`일 때 풀·추천어·기본 검색어에 반영.
   */
  menuPreferenceLabels?: readonly string[] | null;
  /** `major_code`가 Eat & Drink일 때 카테고리명·시각·인원을 추천어에 더 밀착하고, 브런치류 단어를 메뉴와 어긋나게 붙이지 않음 */
  majorCode?: string | null;
  /** Active & Life Step2 활동 종류 — 네이버 장소 시드에 공원·경기장 등 반영 */
  activityKindLabels?: readonly string[] | null;
  /** Play & Vibe Step2 게임 종류 — PC방·보드게임카페 등 시드 반영 */
  placeGameKindLabels?: readonly string[] | null;
  /** Focus & Knowledge Step2 모임 성격 */
  focusKnowledgePreferenceLabels?: readonly string[] | null;
};

function placeQuerySpecialty(input: PlaceQueryBuilderInput): SpecialtyKind | null {
  const k = input.specialtyKind;
  if (k === 'movie' || k === 'food' || k === 'sports' || k === 'knowledge') return k;
  return resolveSpecialtyKind(input.categoryLabel);
}

function normalizedMenuPrefs(input: PlaceQueryBuilderInput): string[] {
  const a = input.menuPreferenceLabels;
  if (!a?.length) return [];
  return [...new Set(a.map((x) => String(x ?? '').trim()).filter(Boolean))];
}

function normalizedActivityKinds(input: PlaceQueryBuilderInput): string[] {
  const a = input.activityKindLabels;
  if (!a?.length) return [];
  return [...new Set(a.map((x) => String(x ?? '').trim()).filter(Boolean))];
}

function normalizedFocusKnowledgePrefs(input: PlaceQueryBuilderInput): string[] {
  const a = input.focusKnowledgePreferenceLabels;
  if (!a?.length) return [];
  return [...new Set(a.map((x) => String(x ?? '').trim()).filter(Boolean))];
}

function normalizedGameKinds(input: PlaceQueryBuilderInput): string[] {
  const a = input.placeGameKindLabels;
  if (!a?.length) return [];
  return [...new Set(a.map((x) => String(x ?? '').trim()).filter(Boolean))];
}

function isActiveLifeSportsPlaceQuery(input: PlaceQueryBuilderInput): boolean {
  return isActiveLifeMajorCode(input.majorCode) && placeQuerySpecialty(input) === 'sports';
}

function isPlayAndVibeGamesPlaceQuery(input: PlaceQueryBuilderInput): boolean {
  return isPlayAndVibeMajorCode(input.majorCode) && placeQuerySpecialty(input) === 'sports';
}

function isPcGamePlaceQuery(input: PlaceQueryBuilderInput): boolean {
  return isPcGameMajorCode(input.majorCode) && placeQuerySpecialty(input) === 'sports';
}

/** PcGame 장소 추천어 — 네이버 지역 검색에 맞는 프랜차이즈·대표 브랜드 키워드(지역명과 결합) */
const PC_BANG_BRAND_CHIP_SUFFIXES = [
  '탑존',
  '액토즈',
  '피카PC',
  '올리브PC',
  '제트존',
  '로얄PC',
  'PC방',
  'e스포츠',
] as const;

const PLAY_VIBE_GAME_FLOOR_POOL = [
  'PC방',
  '보드게임카페',
  '방탈출카페',
  '오락실',
  '볼링장',
  '당구장',
  '노래방',
  'VR체험',
] as const;

/** 게임 종류 칩 → 네이버 지역 검색 시설 키워드 */
function venueSearchTokensForGameKind(gameLabel: string): readonly string[] {
  const k = gameLabel.trim();
  switch (k) {
    case '보드게임':
      return ['보드게임카페', '보드게임 카페', '테이블게임'] as const;
    case '방탈출':
      return ['방탈출카페', '방탈출 카페', '테마카페'] as const;
    case '콘솔·스위치':
      return ['콘솔카페', '닌텐도', '플스방', '게임카페'] as const;
    case '모바일·e스포츠':
      return ['PC방', 'e스포츠', '게임장'] as const;
    case '볼링':
      return ['볼링장', '볼링'] as const;
    case '당구·포켓볼':
      return ['당구장', '포켓볼'] as const;
    case 'VR·체험':
      return ['VR체험', 'VR카페', '체험관'] as const;
    case '노래방':
      return ['노래방', '코인노래방'] as const;
    case '카드게임':
      return ['보드게임카페', '카드게임'] as const;
    case '오락실·아케이드':
      return ['오락실', '아케이드', '게임랜드'] as const;
    case '기타':
      return ['게임카페', '오락실'] as const;
    default:
      return ['게임카페', '오락실'] as const;
  }
}

/** 활동 종류 칩 라벨 → 네이버 지역 검색에 맞는 시설·장소 키워드 풀 */
function venueSearchTokensForActivityKind(activityLabel: string): readonly string[] {
  const k = activityLabel.trim();
  switch (k) {
    case '러닝·조깅':
      return ['공원', '둘레길', '운동장', '트랙', '한강공원'] as const;
    case '등산·트레킹':
      return ['등산로', '둘레길', '국립공원', '산행코스', '지리산 입구', '북한산'] as const;
    case '산책·워킹':
      return ['공원', '산책로', '둘레길', '숲길'] as const;
    case '자전거·라이딩':
      return ['자전거도로', '둘레길', '한강공원', '라이딩'] as const;
    case '클라이밍':
      return ['클라이밍장', '암장', '실내클라이밍'] as const;
    case '풋살·축구':
      return ['풋살경기장', '운동장', '축구장'] as const;
    case '배드민턴·테니스':
      return ['배드민턴장', '테니스장', '실내체육관'] as const;
    case '요가·필라테스':
      return ['요가스튜디오', '필라테스', '요가'] as const;
    case '수영':
      return ['수영장', '실내수영장'] as const;
    case '헬스·근력':
      return ['헬스장', '피트니스'] as const;
    case '크로스핏':
      return ['크로스핏', '헬스장'] as const;
    case '댄스·에어로빅':
      return ['댄스학원', '스튜디오', '줌바'] as const;
    default:
      return ['공원', '운동장'] as const;
  }
}

function isEatAndDrinkMajorCode(majorCode: string | null | undefined): boolean {
  return (majorCode ?? '').trim().toLowerCase() === 'eat & drink';
}

/** 카페·브런치 계열 메뉴/카테고리일 때만 아침 슬롯의 브런치·베이커리 단어를 허용 */
function prefersBrunchyOrCafeMenuTokens(prefs: readonly string[], categoryLabel: string): boolean {
  if (labelExtraKind(categoryLabel) === 'cafe') return true;
  const L = categoryLabel.trim();
  if (/브런치/.test(L)) return true;
  for (const p of prefs) {
    const t = String(p ?? '').trim();
    if (!t) continue;
    if (/브런치|카페·디저트|디저트|카페|커피|티타임/.test(t)) return true;
  }
  return false;
}

function shouldAvoidBrunchyTokens(input: PlaceQueryBuilderInput): boolean {
  if (!isEatAndDrinkMajorCode(input.majorCode)) return false;
  if (placeQuerySpecialty(input) !== 'food') return false;
  const prefs = normalizedMenuPrefs(input);
  const label = (input.categoryLabel ?? '').trim();
  return !prefersBrunchyOrCafeMenuTokens(prefs, label);
}

function eatDrinkCategoryLabelSnippet(label: string): string {
  const t = label.trim();
  if (!t) return '모임';
  return t.length <= 14 ? t : t.slice(0, 12).trim();
}

function filterBrunchyTokensFromPool(pool: readonly string[], input: PlaceQueryBuilderInput): readonly string[] {
  if (!shouldAvoidBrunchyTokens(input)) return pool;
  const out = pool.filter((w) => !/브런치|베이커리/.test(w));
  return out.length ? out : pool;
}

/** 아침대도 브런치가 아닌 식사 성향이면 시간대 키워드에서 브런치·베이커리 제외 */
function timeSlotWordsForPlaceQuery(input: PlaceQueryBuilderInput, hour: number): readonly string[] {
  const base = timeSlotPool(hour);
  if (!shouldAvoidBrunchyTokens(input)) return base;
  const filtered = base.filter((w) => !/브런치|베이커리/.test(w));
  if (filtered.length >= 2) return filtered;
  if (hour >= 5 && hour < 11) return ['한식', '맛집', '덮밥'] as const;
  return filtered.length ? filtered : base;
}

function djb2Hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h, 33) ^ str.charCodeAt(i);
  }
  return h >>> 0;
}

function pick<T>(arr: readonly T[], seed: number): T {
  if (arr.length === 0) throw new Error('pick: empty array');
  return arr[Math.abs(seed) % arr.length]!;
}

function parseHour(hm: string | undefined): number | null {
  if (!hm?.trim()) return null;
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(hm.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  if (!Number.isFinite(hh)) return null;
  return Math.min(23, Math.max(0, Math.floor(hh)));
}

function hourForSchedule(sched: PlaceQueryScheduleInput | null | undefined): number {
  const h = parseHour(sched?.startTime);
  if (h != null) return h;
  return 15;
}

function ymdDow(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  const d = new Date(y, mo - 1, da);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
  return d.getDay();
}

function timeSlotPool(hour: number): readonly string[] {
  if (hour >= 5 && hour < 11) return ['브런치', '아침', '베이커리'] as const;
  if (hour >= 11 && hour < 14) return ['점심', '한식', '덮밥'] as const;
  if (hour >= 14 && hour < 17) return ['오후', '카페', '디저트'] as const;
  if (hour >= 17 && hour < 22) return ['저녁', '회식', '술집'] as const;
  return ['야식', '포장마차', '술집'] as const;
}

type CapacityHint = 'small' | 'large' | null;

function resolveCapacityHint(input: PlaceQueryBuilderInput): CapacityHint {
  const min = input.minParticipants;
  const max = input.maxParticipants;
  if (min == null && max == null) return null;
  const minN = typeof min === 'number' && Number.isFinite(min) ? min : PARTICIPANT_MIN_FALLBACK;
  const maxN = typeof max === 'number' && Number.isFinite(max) ? max : minN;
  const unlimited = maxN >= CAPACITY_UNLIMITED;
  if (unlimited) {
    if (minN >= 8) return 'large';
    if (minN <= 4) return 'small';
    return null;
  }
  if (maxN <= 4) return 'small';
  if (maxN >= 8) return 'large';
  return null;
}

function capacityKeywords(hint: CapacityHint, seed: number): readonly string[] {
  if (hint === 'small') return ['2인석', '조용한', '소규모'] as const;
  if (hint === 'large') return ['단체석', '회식', '룸'] as const;
  return [] as const;
}

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 추천 칩용 짧은 카테고리 조각(라벨 앞부분 또는 테마 단어) */
function categoryChipFragment(label: string, specialty: SpecialtyKind | null, seed: number, input: PlaceQueryBuilderInput): string | null {
  const mp = normalizedMenuPrefs(input);
  const ap = normalizedActivityKinds(input);
  const gk = normalizedGameKinds(input);
  const fk = normalizedFocusKnowledgePrefs(input);
  if (specialty === 'knowledge' && fk.length > 0) {
    return pick(fk, seed);
  }
  if (specialty === 'sports' && isPlayAndVibeMajorCode(input.majorCode) && gk.length > 0) {
    return pick(gk, seed);
  }
  if (specialty === 'sports' && isPcGameMajorCode(input.majorCode) && gk.length > 0) {
    return pick(gk, seed);
  }
  if (specialty === 'sports' && isActiveLifeMajorCode(input.majorCode) && ap.length > 0) {
    return pick(ap, seed);
  }
  if (specialty === 'food' && mp.length > 0) {
    return pick(mp, seed);
  }
  const L = label.trim();
  if (!L) return null;
  if (L.length <= 8) return L;
  const cut = L.slice(0, 8).trim();
  if (cut.length >= 2) return cut;
  if (specialty === 'movie') return pick(['영화', '극장'], seed);
  if (specialty === 'food') return pick(['맛집', '식사'], seed);
  if (specialty === 'sports') return pick(['운동', '모임'], seed);
  if (specialty === 'knowledge') return pick(['스터디', '북카페', '카페', '커피'], seed);
  return pick(['모임', '만남'], seed);
}

/** 인원 칩 문구 (비공개 등 min/max 전달 시) */
function buildHeadcountHint(input: PlaceQueryBuilderInput): string | null {
  const min = input.minParticipants;
  const max = input.maxParticipants;
  if (min == null && max == null) return null;
  const minN = typeof min === 'number' && Number.isFinite(min) ? Math.max(1, Math.floor(min)) : null;
  const maxN = typeof max === 'number' && Number.isFinite(max) ? Math.floor(max) : minN;
  if (minN == null) return null;
  if (maxN == null || maxN >= CAPACITY_UNLIMITED) {
    return `${minN}명 이상`;
  }
  if (minN === maxN) return `${minN}명`;
  return `${minN}~${maxN}명`;
}

function weekdayChipLabel(dow: number | null, seed: number): string | null {
  if (dow == null || dow < 0 || dow > 6) return null;
  const w = DOW_KO[dow];
  return pick([`${w}요일`, `${w}`, dow === 5 || dow === 6 || dow === 0 ? '주말' : `${w}요일`], seed);
}

const MOVIE_POOL = [
  '영화관',
  'CGV',
  '메가박스',
  '롯데시네마',
  '극장가 맛집',
  '용산 영화관',
  '영화 팝콘',
] as const;

const FOOD_GENERAL_POOL = [
  '맛집',
  '한식',
  '양식',
  '이자카야',
  '삼겹살',
  '스시',
  '파스타',
  '데이트 맛집',
  '브런치',
] as const;

const CAFE_POOL = [
  '카페',
  '브런치 카페',
  '디저트',
  '감성 카페',
  '대형 카페',
  '베이커리',
  '루프탑 카페',
] as const;

const SPORTS_POOL = [
  '헬스장',
  '공원',
  '배드민턴장',
  '클라이밍',
  '수영장',
  '러닝 코스',
  '풋살장',
] as const;

const KNOWLEDGE_POOL = [
  '스터디카페',
  '북카페',
  '도서관',
  '코워킹스페이스',
  '세미나실',
  '스터디룸',
  '토론카페',
  '독서실',
  /** 카공·휴식 겸용 장소 후보 */
  '카페',
  '커피숍',
  '조용한 카페',
  '노트북 카페',
  '대형 카페',
  '감성 카페',
  '루프탑 카페',
  '브런치 카페',
  '프랜차이즈 카페',
] as const;

const BAR_POOL = ['술집', '이자카야', '와인바', '맥주집', '포장마차', '하이볼'] as const;

const CULTURE_POOL = ['전시', '미술관', '갤러리', '공연장', '뮤지컬', '박물관'] as const;

const PARK_POOL = ['공원', '산책로', '한강', '피크닉', '야외'] as const;

const GENERIC_POOL = ['모임', '만남', '데이트', '스터디 카페', '보드게임'] as const;

function labelExtraKind(label: string): 'cafe' | 'bar' | 'culture' | 'park' | null {
  const L = label.trim();
  if (/카페|커피|디저트|티타임|브런치/.test(L)) return 'cafe';
  if (/술|맥주|바|주점|포차|이자카야/.test(L)) return 'bar';
  if (/전시|미술|공연|문화|뮤지컬|갤러리/.test(L)) return 'culture';
  if (/산책|공원|한강|피크닉/.test(L)) return 'park';
  return null;
}

/** 영화 모임(카테고리 라벨·특화 종류) — 장소 시드 전용 */
function isMovieCategoryLabel(label: string, specialty: SpecialtyKind | null): boolean {
  const L = label.trim();
  if (!L) return false;
  if (specialty === 'movie') return true;
  return /영화|무비|시네마|시네|극장|OTT|넷플/.test(L);
}

function themePoolForLabel(label: string, specialty: SpecialtyKind | null): readonly string[] {
  const L = label.trim();
  const extra = labelExtraKind(L);

  if (isMovieCategoryLabel(L, specialty)) return MOVIE_POOL;
  if (specialty === 'knowledge' || /스터디|북카페|강연|세미나|토론|학습|카공|코워킹/.test(L)) {
    return KNOWLEDGE_POOL;
  }
  if (specialty === 'sports' || /운동|헬스|러닝|런닝|등산|요가|짐|스포츠|크로스핏|수영/.test(L)) {
    return SPORTS_POOL;
  }
  if (specialty === 'food' || /맛집|식사|레스토랑|밥|먹거리|고기|회식|식당/.test(L)) {
    if (extra === 'cafe') return CAFE_POOL;
    return FOOD_GENERAL_POOL;
  }
  if (extra === 'cafe') return CAFE_POOL;
  if (extra === 'bar') return BAR_POOL;
  if (extra === 'culture') return CULTURE_POOL;
  if (extra === 'park') return PARK_POOL;

  const noun = L.length > 8 ? `${L.slice(0, 8)}` : L;
  if (noun.length >= 2) {
    const mixed = [noun, ...GENERIC_POOL] as string[];
    return mixed;
  }
  return GENERIC_POOL;
}

/** 메뉴 성향이 있으면 풀 선두에 반영(맛집 시드 다양화). Active & Life는 활동별 장소 키워드 풀 병합. */
function themePoolForPlaceQuery(input: PlaceQueryBuilderInput): readonly string[] {
  const label = (input.categoryLabel ?? '').trim() || '모임';
  const specialty = placeQuerySpecialty(input);
  if (isPcGamePlaceQuery(input)) {
    return PC_BANG_BRAND_CHIP_SUFFIXES;
  }
  const prefs = normalizedMenuPrefs(input);
  const acts = normalizedActivityKinds(input);
  const fk = normalizedFocusKnowledgePrefs(input);
  if (placeQuerySpecialty(input) === 'knowledge' && fk.length > 0) {
    const merged: string[] = [...fk];
    for (const x of KNOWLEDGE_POOL) {
      if (!merged.includes(x)) merged.push(x);
    }
    return merged;
  }
  const games = normalizedGameKinds(input);
  if (isPlayAndVibeGamesPlaceQuery(input) && games.length > 0) {
    const merged: string[] = [];
    for (const g of games) {
      for (const tok of venueSearchTokensForGameKind(g)) {
        if (!merged.includes(tok)) merged.push(tok);
      }
    }
    for (const x of PLAY_VIBE_GAME_FLOOR_POOL) {
      if (!merged.includes(x)) merged.push(x);
    }
    return merged;
  }
  if (isActiveLifeSportsPlaceQuery(input) && acts.length > 0) {
    const merged: string[] = [];
    for (const act of acts) {
      for (const tok of venueSearchTokensForActivityKind(act)) {
        if (!merged.includes(tok)) merged.push(tok);
      }
    }
    for (const x of SPORTS_POOL) {
      if (!merged.includes(x)) merged.push(x);
    }
    return merged;
  }
  if (specialty === 'food' && prefs.length > 0) {
    const extra = labelExtraKind(label);
    const prefLooksCafe = prefs.some((p) => /카페|디저트|브런치|커피|티타임/.test(p));
    const basePool = extra === 'cafe' || prefLooksCafe ? CAFE_POOL : FOOD_GENERAL_POOL;
    const merged: string[] = [...prefs];
    for (const x of basePool) {
      if (!merged.includes(x)) merged.push(x);
    }
    return filterBrunchyTokensFromPool(merged, input);
  }
  return filterBrunchyTokensFromPool(themePoolForLabel(label, specialty), input);
}

function buildSeedNumber(input: PlaceQueryBuilderInput): number {
  const b = (input.bias ?? '').trim();
  const lab = (input.categoryLabel ?? '').trim();
  const sd = input.schedule?.startDate?.trim() ?? '';
  const st = input.schedule?.startTime?.trim() ?? '';
  const mn = input.minParticipants ?? '';
  const mx = input.maxParticipants ?? '';
  const mp = normalizedMenuPrefs(input).join('\u0002');
  const ak = normalizedActivityKinds(input).join('\u0003');
  const fk = normalizedFocusKnowledgePrefs(input).join('\u0004');
  const gg = normalizedGameKinds(input).join('\u0005');
  const mc = (input.majorCode ?? '').trim();
  return djb2Hash([b, lab, sd, st, String(mn), String(mx), mp, mc, ak, fk, gg].join('\u001f'));
}

function joinQueryParts(parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 장소 검색 입력란 기본값 (구역 + 시간대·테마·인원 보강).
 * 영화 모임은 **지역 + 영화관** 고정.
 * Play & Vibe(게임 종류 선택 시)는 **지역 + 게임 종류**만 사용.
 * PcGame major는 **지역 + 브랜드 PC방** 중 하나(시드 기반).
 */
export function buildDefaultPlaceSearchQuery(input: PlaceQueryBuilderInput): string {
  const seed = buildSeedNumber(input);
  const bias = (input.bias ?? '').trim() || null;
  const label = (input.categoryLabel ?? '').trim() || '모임';
  const specialty = placeQuerySpecialty(input);
  if (isMovieCategoryLabel(label, specialty)) {
    return joinQueryParts([bias, '영화관']);
  }
  if (isPcGamePlaceQuery(input)) {
    return joinQueryParts([bias, pick(PC_BANG_BRAND_CHIP_SUFFIXES, seed)]);
  }
  const playVibeGamesEarly = normalizedGameKinds(input);
  if (isPlayAndVibeGamesPlaceQuery(input) && playVibeGamesEarly.length > 0) {
    return joinQueryParts([bias, pick(playVibeGamesEarly, seed)]);
  }
  const pool = themePoolForPlaceQuery(input);
  const prefs = normalizedMenuPrefs(input);
  const main = pick(pool, seed);
  const hour = hourForSchedule(input.schedule ?? null);
  const timeCandidates = timeSlotWordsForPlaceQuery(input, hour);
  const timeWord = pick(timeCandidates, seed >>> 7);
  const capHint = resolveCapacityHint(input);
  const capPool = capacityKeywords(capHint, seed);
  const capWord = capPool.length ? pick(capPool, seed >>> 11) : null;

  const ymd = input.schedule?.startDate?.trim() ?? '';
  const dow = ymd ? ymdDow(ymd) : null;
  const weekendLead =
    dow != null && (dow === 5 || dow === 6 || dow === 0) && (seed & 3) === 0 ? pick(['주말', '불금'], seed >>> 13) : null;

  const includeTime = (seed & 5) !== 0;
  const includeCap = capWord != null && (seed & 1) === 0;
  const eatDrinkFood = isEatAndDrinkMajorCode(input.majorCode) && specialty === 'food';
  const acts = normalizedActivityKinds(input);
  const activeLifeWithActivity = isActiveLifeSportsPlaceQuery(input) && acts.length > 0;
  const fkPrefs = normalizedFocusKnowledgePrefs(input);
  const knowledgeWithPrefs = specialty === 'knowledge' && fkPrefs.length > 0;
  const hmRaw = (input.schedule?.startTime ?? '').trim();
  const hourParsed = parseHour(hmRaw);
  const timeClockLabel = hourParsed != null ? `${hourParsed}시` : null;
  const headCountHint = buildHeadcountHint(input);

  const parts: string[] = [];
  if (bias) parts.push(bias);
  if (specialty === 'food' && prefs.length > 0 && (seed & 7) !== 0) {
    parts.push(pick(prefs, seed >>> 5));
  }
  if (activeLifeWithActivity && (seed & 7) !== 0) {
    parts.push(pick(acts, seed >>> 5));
  }
  if (knowledgeWithPrefs && (seed & 7) !== 0) {
    parts.push(pick(fkPrefs, seed >>> 5));
  }
  if (eatDrinkFood) {
    const sn = eatDrinkCategoryLabelSnippet(label);
    if (sn.length >= 2 && !parts.includes(sn)) parts.push(sn);
  }
  if (activeLifeWithActivity) {
    const sn = eatDrinkCategoryLabelSnippet(label);
    if (sn.length >= 2 && !parts.includes(sn)) parts.push(sn);
  }
  if (knowledgeWithPrefs) {
    const sn = eatDrinkCategoryLabelSnippet(label);
    if (sn.length >= 2 && !parts.includes(sn)) parts.push(sn);
  }
  if (weekendLead) parts.push(weekendLead);
  if (eatDrinkFood && timeClockLabel && includeTime && timeClockLabel !== main) {
    parts.push(timeClockLabel);
  } else if (!activeLifeWithActivity && !knowledgeWithPrefs && includeTime && timeWord && timeWord !== main) {
    parts.push(timeWord);
  }
  parts.push(main);
  if (includeCap && capWord) parts.push(capWord);
  if (eatDrinkFood && headCountHint && (seed & 2) === 0) parts.push(headCountHint);
  if (activeLifeWithActivity && headCountHint && (seed & 2) === 0) parts.push(headCountHint);
  if (knowledgeWithPrefs && headCountHint && (seed & 2) === 0) parts.push(headCountHint);
  return joinQueryParts(parts);
}

const MAX_PLACE_SUGGEST_CHIPS = 8;

/** 영화 모임 추천 칩: 지역 + 멀티플렉스·DVD방 등 */
const MOVIE_VENUE_CHIP_SUFFIXES = [
  'CGV',
  '메가박스',
  '롯데시네마',
  'DVD방',
  '영화관',
  '무비월드',
  '씨네큐',
] as const;

function buildMoviePlaceSuggestedQueries(bias: string, seed: number): string[] {
  const b = bias.trim();
  const items = MOVIE_VENUE_CHIP_SUFFIXES.map((suf) => joinQueryParts([b, suf])).filter((q) => q.length > 0);
  const scored = items.map((v, i) => ({ v, k: djb2Hash(`${seed}|moviechip|${i}|${v}`) }));
  scored.sort((x, y) => x.k - y.k);
  const out: string[] = [];
  for (const { v } of scored) {
    if (!out.includes(v)) out.push(v);
    if (out.length >= MAX_PLACE_SUGGEST_CHIPS) break;
  }
  return out;
}

/** Play & Vibe — 지역 + Step2 게임 종류(및 해당 시설 검색 토큰)만으로 추천어 생성 */
function buildPlayVibePlaceSuggestedQueries(bias: string, gameKinds: readonly string[], seed: number): string[] {
  const b = bias.trim();
  const items: string[] = [];
  for (const g of gameKinds) {
    const gtrim = String(g ?? '').trim();
    if (!gtrim) continue;
    items.push(joinQueryParts([b, gtrim]));
    for (const tok of venueSearchTokensForGameKind(gtrim)) {
      items.push(joinQueryParts([b, tok]));
    }
  }
  const scored = items.map((v, i) => ({ v, k: djb2Hash(`${seed}|playvibechip|${i}|${v}`) }));
  scored.sort((x, y) => x.k - y.k);
  const out: string[] = [];
  for (const { v } of scored) {
    if (!v || out.includes(v)) continue;
    out.push(v);
    if (out.length >= MAX_PLACE_SUGGEST_CHIPS) break;
  }
  return out;
}

/** PcGame major — 추천어: 지역 + 탑존·액토즈 등 브랜드 PC방 키워드(최대 8개) */
function buildPcGamePlaceSuggestedQueries(bias: string, seed: number): string[] {
  const b = bias.trim();
  const items = PC_BANG_BRAND_CHIP_SUFFIXES.map((suf) => joinQueryParts([b, suf])).filter((q) => q.length > 0);
  const scored = items.map((v, i) => ({ v, k: djb2Hash(`${seed}|pcgamechip|${i}|${v}`) }));
  scored.sort((x, y) => x.k - y.k);
  const out: string[] = [];
  for (const { v } of scored) {
    if (!v || out.includes(v)) continue;
    out.push(v);
    if (out.length >= MAX_PLACE_SUGGEST_CHIPS) break;
  }
  return out;
}

/**
 * 추천 검색어 칩 — 지역(bias)·카테고리·요일·인원·테마를 조합해 다양하게 생성 (최대 8개). 시각·시간대 단어는 넣지 않음.
 * 영화 모임은 지역 + CGV·메가박스·롯데시네마·DVD방 등 고정 패턴.
 * Play & Vibe(게임 종류 선택 시)는 지역 + 게임 종류·시설 키워드만 사용.
 * PcGame major는 지역 + 탑존·액토즈 등 브랜드 PC방 키워드.
 */
export function buildPlaceSuggestedSearchQueries(input: PlaceQueryBuilderInput): string[] {
  const bias = (input.bias ?? '').trim();
  const label = (input.categoryLabel ?? '').trim() || '모임';
  const seed = buildSeedNumber(input);
  const specialty = placeQuerySpecialty(input);
  if (isMovieCategoryLabel(label, specialty)) {
    return buildMoviePlaceSuggestedQueries(bias, seed);
  }
  if (isPcGamePlaceQuery(input)) {
    return buildPcGamePlaceSuggestedQueries(bias, seed);
  }
  const gameKindsEarly = normalizedGameKinds(input);
  if (isPlayAndVibeGamesPlaceQuery(input) && gameKindsEarly.length > 0) {
    return buildPlayVibePlaceSuggestedQueries(bias, gameKindsEarly, seed);
  }
  const pool = themePoolForPlaceQuery(input);
  const prefs = normalizedMenuPrefs(input);
  const capHint = resolveCapacityHint(input);
  const capPool = capacityKeywords(capHint, seed);
  const capWord = capPool.length ? pick(capPool, seed >>> 5) : '';
  const ymd = input.schedule?.startDate?.trim() ?? '';
  const dow = ymd ? ymdDow(ymd) : null;
  const weekdayStr = weekdayChipLabel(dow, seed >>> 9);
  const headCount = buildHeadcountHint(input);
  const catFrag = categoryChipFragment(label, specialty, seed >>> 11, input);
  const eatDrinkFood = isEatAndDrinkMajorCode(input.majorCode) && specialty === 'food';
  const actKinds = normalizedActivityKinds(input);
  const activeLifeSports = isActiveLifeSportsPlaceQuery(input) && actKinds.length > 0;
  const fkList = normalizedFocusKnowledgePrefs(input);
  const knowledgePrefs = specialty === 'knowledge' && fkList.length > 0;
  const labelSnippet =
    eatDrinkFood || activeLifeSports || knowledgePrefs
      ? eatDrinkCategoryLabelSnippet(label)
      : label.length <= 10
        ? label
        : catFrag;

  const out: string[] = [];
  const push = (q: string) => {
    const t = q.replace(/\s+/g, ' ').trim();
    if (!t || out.includes(t)) return;
    out.push(t);
  };

  const mk = (salt: number) => {
    const s = seed + salt * 7919;
    return {
      main: pick(pool, s),
      cap: capPool.length ? pick(capPool, s >>> 7) : capWord,
    };
  };

  const rawVariants: string[] = [];

  if (eatDrinkFood) {
    const p0 = prefs[0];
    const mainAlt = pick(pool, seed + 401);
    rawVariants.push(
      joinQueryParts([bias, labelSnippet, p0, headCount]),
      joinQueryParts([bias, labelSnippet, catFrag, headCount]),
      joinQueryParts([bias, labelSnippet, headCount]),
      joinQueryParts([bias, p0, labelSnippet]),
      joinQueryParts([bias, catFrag, headCount, mainAlt]),
    );
  }

  if (knowledgePrefs) {
    const p0 = fkList[0]!;
    const mainAlt = pick(pool, seed + 401);
    rawVariants.push(
      joinQueryParts([bias, labelSnippet, p0, headCount]),
      joinQueryParts([bias, labelSnippet, catFrag, headCount]),
      joinQueryParts([bias, labelSnippet, headCount]),
      joinQueryParts([bias, p0, labelSnippet]),
      joinQueryParts([bias, catFrag, headCount, mainAlt]),
    );
  }

  if (specialty === 'knowledge') {
    const cafeLead = pick(['카페', '커피숍', '노트북 카페', '스터디카페'], seed >>> 29);
    const cafeAlt = pick(['북카페', '조용한 카페', '대형 카페'], seed >>> 31);
    rawVariants.push(joinQueryParts([bias, cafeLead, labelSnippet]));
    rawVariants.push(joinQueryParts([bias, cafeAlt, headCount]));
    rawVariants.push(joinQueryParts([bias, labelSnippet, cafeLead, catFrag]));
  }

  if (activeLifeSports) {
    const p0 = actKinds[0]!;
    const toks = [...venueSearchTokensForActivityKind(p0)];
    const vn0 = pick(toks, seed + 411);
    const vn1 = pick(toks, seed + 433);
    const mainAlt = pick(pool, seed + 401);
    rawVariants.push(
      joinQueryParts([bias, labelSnippet, p0, vn0]),
      joinQueryParts([bias, labelSnippet, vn1, headCount]),
      joinQueryParts([bias, p0, vn0]),
      joinQueryParts([bias, labelSnippet, catFrag, vn1]),
      joinQueryParts([bias, catFrag, headCount, mainAlt]),
    );
  }

  const a = mk(0);
  rawVariants.push(joinQueryParts([bias, a.main, a.cap]));
  rawVariants.push(joinQueryParts([bias, catFrag, a.main]));
  const b = mk(1);
  rawVariants.push(joinQueryParts([bias, weekdayStr, b.main]));
  rawVariants.push(joinQueryParts([bias, headCount, b.main]));
  const c = mk(2);
  rawVariants.push(joinQueryParts([bias, headCount, c.main]));
  rawVariants.push(joinQueryParts([bias, catFrag, c.main]));
  const d = mk(3);
  rawVariants.push(joinQueryParts([bias, catFrag, d.main]));
  if (dow === 5 || dow === 6 || dow === 0) {
    const wk = pick(['주말', '불금'], seed >>> 13);
    rawVariants.push(joinQueryParts([bias, wk, d.main]));
  } else {
    rawVariants.push(joinQueryParts([bias, weekdayStr, d.main]));
  }
  const e = mk(4);
  rawVariants.push(joinQueryParts([bias, e.main]));
  rawVariants.push(joinQueryParts([bias, weekdayStr, e.main]));
  const f = mk(5);
  rawVariants.push(joinQueryParts([bias, headCount, f.main]));
  rawVariants.push(joinQueryParts([bias, catFrag, f.cap, f.main]));
  const g = mk(6);
  rawVariants.push(joinQueryParts([bias, labelSnippet, g.main]));
  if (!bias) {
    rawVariants.push(joinQueryParts([catFrag, g.main]));
    rawVariants.push(joinQueryParts([headCount, g.main]));
  }

  if (specialty === 'food' && prefs.length > 0) {
    for (let i = 0; i < prefs.length; i += 1) {
      const p = prefs[i]!;
      const xv = mk(200 + i * 17);
      rawVariants.push(joinQueryParts([bias, p, xv.main]));
      rawVariants.push(joinQueryParts([bias, p, '맛집']));
      rawVariants.push(joinQueryParts([bias, p, xv.main, weekdayStr]));
      rawVariants.push(joinQueryParts([bias, p, weekdayStr, xv.main]));
    }
  }

  if (knowledgePrefs) {
    for (let i = 0; i < fkList.length; i += 1) {
      const p = fkList[i]!;
      const xv = mk(260 + i * 17);
      rawVariants.push(joinQueryParts([bias, p, xv.main]));
      rawVariants.push(joinQueryParts([bias, labelSnippet, p, xv.main]));
      rawVariants.push(joinQueryParts([bias, p, xv.main, weekdayStr]));
      rawVariants.push(joinQueryParts([bias, p, weekdayStr, xv.main]));
    }
  }

  if (activeLifeSports) {
    for (let i = 0; i < actKinds.length; i += 1) {
      const p = actKinds[i]!;
      const toks = [...venueSearchTokensForActivityKind(p)];
      const vn = pick(toks, seed + 280 + i * 23);
      const vn2 = pick(toks, seed + 290 + i * 23);
      const xv = mk(240 + i * 19);
      rawVariants.push(joinQueryParts([bias, labelSnippet, p, vn]));
      rawVariants.push(joinQueryParts([bias, p, vn2]));
      rawVariants.push(joinQueryParts([bias, vn, weekdayStr]));
      rawVariants.push(joinQueryParts([bias, p, xv.main, weekdayStr]));
    }
  }

  const scored = rawVariants
    .filter((v) => v.length > 0)
    .map((v, i) => ({ v, k: djb2Hash(`${seed}|suggest|${i}|${v}`) }));
  scored.sort((x, y) => x.k - y.k);
  for (const { v } of scored) {
    push(v);
    if (out.length >= MAX_PLACE_SUGGEST_CHIPS) break;
  }
  for (let j = 0; j < 24 && out.length < MAX_PLACE_SUGGEST_CHIPS; j += 1) {
    const x = mk(50 + j);
    push(joinQueryParts([bias, weekdayStr, x.main]));
    push(joinQueryParts([bias, x.main, x.cap]));
  }

  return out.slice(0, MAX_PLACE_SUGGEST_CHIPS);
}

/** 카테고리만 알 때의 단일 시드(라우트 등 bias 없음) — `place-search-suggestion` 호환 */
export function buildFallbackPlaceSearchQueryFromCategoryLabel(
  categoryLabel: string,
  specialtyKind?: SpecialtyKind | null,
): string {
  return buildDefaultPlaceSearchQuery({
    bias: null,
    categoryLabel,
    schedule: null,
    minParticipants: undefined,
    maxParticipants: undefined,
    specialtyKind: specialtyKind ?? undefined,
  });
}
