/**
 * 모임 생성 장소 단계 — 네이버 지역 검색용 시드 문자열 생성 (클라이언트 전용).
 * 추천어·기본 검색어는 **행정구역(bias) + 테마 한 덩어리** 두 조각만. 일정·인원·용량 단어는 넣지 않음. 날씨는 사용하지 않음.
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
  /** 미전달 시 일정은 추천어·기본 검색어에 반영하지 않음 */
  schedule?: PlaceQueryScheduleInput | null | undefined;
  minParticipants?: number;
  maxParticipants?: number;
  /** 있으면 `categoryLabel` 정규식 대신 사용( `major_code` 기반 특화와 정합 ) */
  specialtyKind?: SpecialtyKind | null;
  /**
   * Eat & Drink 등 메뉴 성향 Step에서 고른 값(예: 한식·카페·디저트).
   * `specialtyKind === 'food'`일 때 풀·추천어·기본 검색어에 반영.
   */
  menuPreferenceLabels?: readonly string[] | null;
  /** `major_code`가 Eat & Drink일 때 카테고리명·인원을 추천어에 더 밀착하고, 브런치류 단어를 메뉴와 어긋나게 붙이지 않음 */
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
    case '콘솔':
      return ['콘솔카페', '닌텐도', '플스방', '게임카페'] as const;
    case 'e스포츠':
      return ['PC방', 'e스포츠', '게임장'] as const;
    case '볼링':
      return ['볼링장', '볼링'] as const;
    case '당구':
      return ['당구장', '포켓볼'] as const;
    case 'VR체험':
      return ['VR체험', 'VR카페', '체험관'] as const;
    case '노래방':
      return ['노래방', '코인노래방'] as const;
    case '카드게임':
      return ['보드게임카페', '카드게임'] as const;
    case '오락실':
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
  /** Step2 칩 `러닝·조깅` 등 복합 라벨 → 단일 키로 매핑 */
  const g =
    (
      {
        '러닝·조깅': '러닝',
        '등산·트레킹': '등산',
        '헬스·근력': '헬스',
        '요가·필라테스': '요가',
        '풋살·축구': '축구',
        '배드민턴·테니스': '배드민턴',
        '자전거·라이딩': '라이딩',
        '산책·워킹': '산책',
        '댄스·에어로빅': '댄스',
      } as const satisfies Record<string, string>
    )[k] ?? k;
  switch (g) {
    case '러닝':
      return ['공원', '둘레길', '운동장', '트랙', '한강공원'] as const;
    case '등산':
      return ['등산로', '둘레길', '국립공원', '산행코스', '지리산 입구', '북한산'] as const;
    case '산책':
      return ['공원', '산책로', '둘레길', '숲길'] as const;
    case '라이딩':
      return ['자전거도로', '둘레길', '한강공원', '라이딩'] as const;
    case '클라이밍':
      return ['클라이밍장', '암장', '실내클라이밍'] as const;
    case '축구':
      return ['풋살경기장', '운동장', '축구장'] as const;
    case '배드민턴':
      return ['배드민턴장', '테니스장', '실내체육관'] as const;
    case '요가':
      return ['요가스튜디오', '필라테스', '요가'] as const;
    case '수영':
      return ['수영장', '실내수영장'] as const;
    case '헬스':
      return ['헬스장', '피트니스'] as const;
    case '크로스핏':
      return ['크로스핏', '헬스장'] as const;
    case '댄스':
      return ['댄스학원', '스튜디오', '줌바'] as const;
    default:
      return ['공원', '운동장'] as const;
  }
}

function isEatAndDrinkMajorCode(majorCode: string | null | undefined): boolean {
  return (majorCode ?? '').trim().toLowerCase() === 'eat & drink';
}

function isFocusKnowledgeMajorCode(majorCode: string | null | undefined): boolean {
  return (majorCode ?? '').trim().toLowerCase() === 'focus & knowledge';
}

/** Eat & Drink major — 브런치·베이커리 허용 여부는 메뉴 성향만 반영 */
function prefersBrunchyOrCafeMenuTokensFromPrefs(prefs: readonly string[]): boolean {
  for (const p of prefs) {
    const t = String(p ?? '').trim();
    if (!t) continue;
    if (/브런치|카페|디저트|커피|티타임/.test(t)) return true;
  }
  return false;
}

function shouldAvoidBrunchyTokens(input: PlaceQueryBuilderInput): boolean {
  if (!isEatAndDrinkMajorCode(input.majorCode)) return false;
  if (placeQuerySpecialty(input) !== 'food') return false;
  const prefs = normalizedMenuPrefs(input);
  return !prefersBrunchyOrCafeMenuTokensFromPrefs(prefs);
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

/** 추천 칩용 짧은 카테고리 조각(라벨 앞부분 또는 테마 단어) */
function categoryChipFragment(label: string, specialty: SpecialtyKind | null, seed: number, input: PlaceQueryBuilderInput): string | null {
  const mp = normalizedMenuPrefs(input);
  const ap = normalizedActivityKinds(input);
  const gk = normalizedGameKinds(input);
  const fk = normalizedFocusKnowledgePrefs(input);
  if (isEatAndDrinkMajorCode(input.majorCode) && specialty === 'food') {
    if (mp.length > 0) return pick(mp, seed);
    return pick(['맛집', '한식', '식당'], seed);
  }
  if (isFocusKnowledgeMajorCode(input.majorCode) && specialty === 'knowledge') {
    return pick(FOCUS_KNOWLEDGE_PLACE_POOL, seed);
  }
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

const PETS_POOL = [
  '애견동반', 
  '고양이 카페', 
  '앵무새 카페',
  '애견동반 카페', 
  '애견동반 식당', 
  '애견카페', 
  '반려견 놀이터', 
  '애견운동장', 
  '실내 애견동반', 
  '마당 있는 애견카페', 
  '테라스 애견동반', 
  '대형견 애견카페', 
  '노키즈존 애견카페', 
  '오프리시 애견운동장'
] as const;

const GOLF_POOL = [
  '스크린골프',
  '골프연습장',
  '골프존',
  '프렌즈스크린', 
  'SG골프', 
  '유니코', 
  '브라보퍼블릭스크린골프', 
  '케이골프' 
] as const;

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

/**
 * Eat & Drink Step2 메뉴 성향(`MenuPreference` 칩)별 네이버 장소 시드 풀.
 * major가 Eat & Drink일 때 카테고리 라벨은 쓰지 않고 이 맵만 연결합니다.
 */
const EAT_DRINK_MENU_PREF_PLACE_POOL: Readonly<Record<string, readonly string[]>> = {
  한식: ['한식', '맛집', '삼겹살', '한정식', '곱창', '백반', '찌개'],
  일식: ['일식', '스시', '라멘', '돈까스', '우동', '이자카야'],
  중식: ['중식', '짜장면', '딤섬', '마라탕', '훠궈'],
  양식: ['양식', '파스타', '스테이크', '브런치', '이탈리안'],
  분식: ['분식', '떡볶이', '김밥', '순대', '튀김'],
  퓨전: ['퓨전', '맛집', '레스토랑', '다이닝'],
  '카페·디저트': ['카페', '디저트', '브런치 카페', '베이커리', '감성 카페', '대형 카페', '루프탑 카페'],
  브런치: ['브런치', '브런치 카페', '베이커리', '카페'],
  '주점·호프': ['호프', '술집', '맥주', '맛집', '포장마차'],
  이자카야: ['이자카야', '술집', '일식', '사케'],
  '와인.바': ['와인바', '와인바', '바', '술집'],
  포차: ['포장마차', '포차', '술집', '맥주집'],
  오마카세: ['오마카세', '스시', '일식', '맛집'],
};

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

/** Focus & Knowledge major — 카테고리·Step2 모임 성격과 무관하게 장소 시드에만 사용 */
const FOCUS_KNOWLEDGE_PLACE_POOL = [
  '카페',
  '스터디카페',
  '독서실',
  '코워킹스페이스',
  '조용한 카페',
  '커피숍',
  '북카페',
  '노트북 카페',
  '도서관',
  '스터디룸',
  '대형 카페',
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

function isGolfCategoryLabel(label: string): boolean {
  const L = label.trim();
  if (!L) return false;
  // 카테고리 라벨이 영어("Golf")로 들어오는 케이스 지원
  if (/^golf$/i.test(L)) return true;
  // 한글 라벨/키워드로 들어오는 케이스 지원
  return /골프|스크린골프|골프존|프렌즈스크린|SG골프/.test(L);
}

function isPetsCategoryLabel(label: string): boolean {
  const L = label.trim();
  if (!L) return false;
  // 카테고리 라벨이 영어로 들어오는 케이스 지원
  if (/^(pet|pets|pet friendly|pet-friendly)$/i.test(L)) return true;
  // 한글 라벨/키워드로 들어오는 케이스 지원
  return /반려동물|반려견|반려묘|애견|강아지|고양이|펫/.test(L);
}

function themePoolForLabel(label: string, specialty: SpecialtyKind | null): readonly string[] {
  const L = label.trim();
  const extra = labelExtraKind(L);

  if (isMovieCategoryLabel(L, specialty)) return MOVIE_POOL;
  if (isGolfCategoryLabel(L)) return GOLF_POOL;
  if (isPetsCategoryLabel(L)) return PETS_POOL;
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
  if (isEatAndDrinkMajorCode(input.majorCode) && specialty === 'food') {
    return filterBrunchyTokensFromPool(buildEatDrinkPlacePoolFromMenuPreferences(prefs), input);
  }
  if (isFocusKnowledgeMajorCode(input.majorCode) && specialty === 'knowledge') {
    return FOCUS_KNOWLEDGE_PLACE_POOL;
  }
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
  const lab =
    isEatAndDrinkMajorCode(input.majorCode) || isFocusKnowledgeMajorCode(input.majorCode)
      ? ''
      : (input.categoryLabel ?? '').trim();
  const mn = input.minParticipants ?? '';
  const mx = input.maxParticipants ?? '';
  const mp = normalizedMenuPrefs(input).join('\u0002');
  const ak = normalizedActivityKinds(input).join('\u0003');
  const fk = isFocusKnowledgeMajorCode(input.majorCode) ? '' : normalizedFocusKnowledgePrefs(input).join('\u0004');
  const gg = normalizedGameKinds(input).join('\u0005');
  const mc = (input.majorCode ?? '').trim();
  return djb2Hash([b, lab, String(mn), String(mx), mp, mc, ak, fk, gg].join('\u001f'));
}

/** `언어·회화` vs `언어회화` 등 동일 토큰을 한 키로 묶어 중복 제거 */
function tokenKeyForPlaceQueryDedupe(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/[\s·•\-_/.,]+/g, '');
}

function eatDrinkPlacePoolForMenuPreference(prefLabel: string): readonly string[] {
  const key = prefLabel.trim();
  const pool = EAT_DRINK_MENU_PREF_PLACE_POOL[key];
  return pool && pool.length > 0 ? pool : FOOD_GENERAL_POOL;
}

/** Eat & Drink major — 선택한 메뉴 성향별 풀을 합쳐 중복 제거(칩 라벨 + 검색 토큰). 성향 없으면 일반 맛집 풀. */
function buildEatDrinkPlacePoolFromMenuPreferences(prefs: readonly string[]): string[] {
  if (!prefs.length) {
    return [...FOOD_GENERAL_POOL];
  }
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const p of prefs) {
    const chip = String(p ?? '').trim();
    if (!chip) continue;
    const kChip = tokenKeyForPlaceQueryDedupe(chip);
    if (kChip && !seen.has(kChip)) {
      seen.add(kChip);
      merged.push(chip);
    }
    for (const w of eatDrinkPlacePoolForMenuPreference(chip)) {
      const t = String(w ?? '').trim();
      if (!t) continue;
      const k = tokenKeyForPlaceQueryDedupe(t);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      merged.push(t);
    }
  }
  return merged.length > 0 ? merged : [...FOOD_GENERAL_POOL];
}

/** 테마 조각: 내부 공백 제거해 한 덩어리로 (예: `대형 카페` → `대형카페`) */
function collapsePlaceThemeToken(raw: string): string {
  return raw.replace(/\s+/g, '').trim();
}

/**
 * 장소 AI 검색어: `[행정구역 bias 전체]` + 공백 1칸 + `[테마 한 덩어리]` (bias 없으면 테마만).
 */
function joinTwoPartPlaceQuery(bias: string | null | undefined, theme: string | null | undefined): string {
  const b = (typeof bias === 'string' ? bias : '').trim();
  const t = collapsePlaceThemeToken(typeof theme === 'string' ? theme.trim() : String(theme ?? '').trim());
  if (!t) return b;
  if (!b) return t;
  return `${b} ${t}`;
}

/**
 * 장소 검색 입력란 기본값 — **행정구역(bias) + 테마 토큰 한 덩어리**만. 일정·인원·용량 단어는 넣지 않음.
 * 영화: 지역 + 영화관. PcGame: 지역 + PC방. Play & Vibe(게임 종류 있음): 지역 + 게임 종류.
 */
export function buildDefaultPlaceSearchQuery(input: PlaceQueryBuilderInput): string {
  const seed = buildSeedNumber(input);
  const bias = (input.bias ?? '').trim() || null;
  const label = (input.categoryLabel ?? '').trim() || '모임';
  const specialty = placeQuerySpecialty(input);
  if (isMovieCategoryLabel(label, specialty)) {
    return joinTwoPartPlaceQuery(bias, '영화관');
  }
  if (isPcGamePlaceQuery(input)) {
    return joinTwoPartPlaceQuery(bias, 'PC방');
  }
  const playVibeGamesEarly = normalizedGameKinds(input);
  if (isPlayAndVibeGamesPlaceQuery(input) && playVibeGamesEarly.length > 0) {
    return joinTwoPartPlaceQuery(bias, pick(playVibeGamesEarly, seed));
  }
  const pool = themePoolForPlaceQuery(input);
  const prefs = normalizedMenuPrefs(input);
  const eatDrinkFood = isEatAndDrinkMajorCode(input.majorCode) && specialty === 'food';
  const acts = normalizedActivityKinds(input);
  const activeLifeWithActivity = isActiveLifeSportsPlaceQuery(input) && acts.length > 0;
  const fkPrefs = normalizedFocusKnowledgePrefs(input);
  const knowledgeWithPrefs =
    specialty === 'knowledge' && fkPrefs.length > 0 && !isFocusKnowledgeMajorCode(input.majorCode);
  const catFrag = categoryChipFragment(label, specialty, seed, input);

  const raws: (string | null | undefined)[] = [pick(pool, seed)];
  if (catFrag) raws.push(catFrag);
  if (eatDrinkFood) {
    if (prefs.length > 0) {
      raws.push(pick(prefs, seed >>> 5));
      raws.push(pick(prefs, seed >>> 7));
    }
  }
  if (activeLifeWithActivity) {
    const sn = eatDrinkCategoryLabelSnippet(label);
    if (sn.length >= 2) raws.push(sn);
    if (acts.length > 0) raws.push(pick(acts, seed >>> 5));
  }
  if (knowledgeWithPrefs) {
    const sn = eatDrinkCategoryLabelSnippet(label);
    if (sn.length >= 2) raws.push(sn);
    if (fkPrefs.length > 0) raws.push(pick(fkPrefs, seed >>> 5));
  }

  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const c = collapsePlaceThemeToken(String(raw ?? '').trim());
    if (!c) continue;
    const k = tokenKeyForPlaceQueryDedupe(c);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
  }
  const second = pick(uniq.length > 0 ? uniq : [collapsePlaceThemeToken(pick(pool, seed))], seed);
  return joinTwoPartPlaceQuery(bias, second);
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
  const items = MOVIE_VENUE_CHIP_SUFFIXES.map((suf) => joinTwoPartPlaceQuery(b, suf)).filter((q) => q.length > 0);
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
    items.push(joinTwoPartPlaceQuery(b, gtrim));
    for (const tok of venueSearchTokensForGameKind(gtrim)) {
      items.push(joinTwoPartPlaceQuery(b, tok));
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

/** PcGame major — 추천어: **지역+PC방**을 맨 앞에 두고, 이어서 탑존·액토즈 등 브랜드 키워드(최대 8개) */
function buildPcGamePlaceSuggestedQueries(bias: string, seed: number): string[] {
  const b = bias.trim();
  const head = joinTwoPartPlaceQuery(b, 'PC방');
  const items = PC_BANG_BRAND_CHIP_SUFFIXES.map((suf) => joinTwoPartPlaceQuery(b, suf)).filter((q) => q.length > 0);
  const scored = items.map((v, i) => ({ v, k: djb2Hash(`${seed}|pcgamechip|${i}|${v}`) }));
  scored.sort((x, y) => x.k - y.k);
  const out: string[] = [];
  if (head) {
    out.push(head);
  }
  for (const { v } of scored) {
    if (!v || out.includes(v)) continue;
    out.push(v);
    if (out.length >= MAX_PLACE_SUGGEST_CHIPS) break;
  }
  return out;
}

/** 추천 칩용 테마 토큰 목록(공백 제거·중복 키 제거) — bias와 조합 전에만 사용 */
function collectPlaceSuggestThemeTokens(
  input: PlaceQueryBuilderInput,
  label: string,
  specialty: SpecialtyKind | null,
  seed: number,
): string[] {
  const pool = themePoolForPlaceQuery(input);
  const prefs = normalizedMenuPrefs(input);
  const catFrag = categoryChipFragment(label, specialty, seed >>> 11, input);
  const eatDrinkFood = isEatAndDrinkMajorCode(input.majorCode) && specialty === 'food';
  const actKinds = normalizedActivityKinds(input);
  const activeLifeSports = isActiveLifeSportsPlaceQuery(input) && actKinds.length > 0;
  const fkList = normalizedFocusKnowledgePrefs(input);
  const focusKnowledgePlaces = isFocusKnowledgeMajorCode(input.majorCode) && specialty === 'knowledge';
  const knowledgePrefs =
    specialty === 'knowledge' && fkList.length > 0 && !isFocusKnowledgeMajorCode(input.majorCode);
  const labelSnippet = eatDrinkFood
    ? pick(prefs.length > 0 ? prefs : (['맛집', '한식'] as const), seed >>> 13)
    : focusKnowledgePlaces
      ? pick(FOCUS_KNOWLEDGE_PLACE_POOL, seed >>> 13)
      : activeLifeSports || knowledgePrefs
        ? eatDrinkCategoryLabelSnippet(label)
        : label.length <= 10
          ? label
          : catFrag;

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const c = collapsePlaceThemeToken(String(raw ?? '').trim());
    if (!c) return;
    const k = tokenKeyForPlaceQueryDedupe(c);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };

  for (const p of pool) add(p);
  add(catFrag);
  add(labelSnippet);

  if (eatDrinkFood) {
    for (const p of prefs) add(p);
    add('맛집');
  }
  if (knowledgePrefs) {
    for (const p of fkList) add(p);
  }
  if (specialty === 'knowledge' && !focusKnowledgePlaces) {
    add(pick(['카페', '커피숍', '노트북 카페', '스터디카페'], seed >>> 29));
    add(pick(['북카페', '조용한 카페', '대형 카페'], seed >>> 31));
  }
  if (activeLifeSports) {
    for (const p of actKinds) {
      add(p);
      for (const tok of venueSearchTokensForActivityKind(p)) add(tok);
    }
  }
  if (specialty === 'food' && prefs.length > 0) {
    for (let i = 0; i < prefs.length; i += 1) add(pick(pool, seed + 200 + i * 17));
  }
  if (knowledgePrefs) {
    for (let i = 0; i < fkList.length; i += 1) add(pick(pool, seed + 260 + i * 17));
  }
  if (activeLifeSports) {
    for (let i = 0; i < actKinds.length; i += 1) add(pick(pool, seed + 240 + i * 19));
  }
  for (let j = 0; j < Math.min(pool.length, 24); j += 1) add(pick(pool, seed + 50 + j * 31));

  return out;
}

/**
 * 추천 검색어 칩 — **행정구역(bias) + 테마 토큰 한 덩어리**만 (최대 8개). 일정·인원·용량 단어 없음.
 * 영화 / PcGame / Play&Vibe(게임 종류)는 전용 분기 유지.
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
  const catFrag = categoryChipFragment(label, specialty, seed >>> 11, input);
  const themes = collectPlaceSuggestThemeTokens(input, label, specialty, seed);
  const rawVariants = themes.map((t) => joinTwoPartPlaceQuery(bias, t));

  const out: string[] = [];
  const push = (q: string) => {
    const t = q.replace(/\s+/g, ' ').trim();
    if (!t || out.includes(t)) return;
    out.push(t);
  };

  const scored = rawVariants
    .filter((v) => v.length > 0)
    .map((v, i) => ({ v, k: djb2Hash(`${seed}|suggest|${i}|${v}`) }));
  scored.sort((x, y) => x.k - y.k);
  for (const { v } of scored) {
    push(v);
    if (out.length >= MAX_PLACE_SUGGEST_CHIPS) break;
  }

  for (let j = 0; j < 60 && out.length < MAX_PLACE_SUGGEST_CHIPS; j += 1) {
    push(joinTwoPartPlaceQuery(bias, pick(pool, seed + 50 + j * 31)));
  }
  if (catFrag) push(joinTwoPartPlaceQuery(bias, catFrag));

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
