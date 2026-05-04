import type { Category } from '@/src/lib/categories';

export type SpecialtyKind = 'movie' | 'food' | 'sports' | 'knowledge';

/** `resolveSpecialtyKind` 라벨 정규식과 정합 — 로컬 NLU 발화 키워드 매칭용 */
const UTTERANCE_HINTS_MOVIE: readonly string[] = [
  '영화',
  '무비',
  '시네마',
  '시네',
  '극장',
  '영화관',
  'OTT',
  '넷플',
  '왓챠',
  '디즈니',
  '상영',
  '관람',
];

const UTTERANCE_HINTS_FOOD: readonly string[] = [
  '맛집',
  '식사',
  '레스토랑',
  '밥',
  '먹거리',
  '고기',
  '회식',
  '식당',
  '카페',
  '커피',
  '디저트',
  '티타임',
  '브런치',
  '술',
  '맥주',
  '와인',
  '점심',
  '저녁',
  '야식',
  '아침',
];

const UTTERANCE_HINTS_SPORTS: readonly string[] = [
  '운동',
  '헬스',
  '러닝',
  '런닝',
  '등산',
  '요가',
  '헬창',
  '짐',
  '스포츠',
  '크로스핏',
  '수영',
  '헬스장',
  '게임',
  '롤',
  '배그',
  'PC방',
  '오락',
  'e스포츠',
  '배틀그라운드',
];

const UTTERANCE_HINTS_KNOWLEDGE: readonly string[] = [
  '스터디',
  '북카페',
  '토론',
  '강연',
  '세미나',
  '워크숍',
  '자격증',
  '회화',
  '북클럽',
  '독서',
  '카공',
  '코딩',
  '개발',
  '밋업',
  '네트워킹',
  '학습',
  '공부',
];

export function getUtteranceKeywordHintsForSpecialty(kind: SpecialtyKind): readonly string[] {
  switch (kind) {
    case 'movie':
      return UTTERANCE_HINTS_MOVIE;
    case 'food':
      return UTTERANCE_HINTS_FOOD;
    case 'sports':
      return UTTERANCE_HINTS_SPORTS;
    case 'knowledge':
      return UTTERANCE_HINTS_KNOWLEDGE;
    default:
      return [];
  }
}

/**
 * DB `meeting_categories.major_code` → Step 2 특화. 대소문자 무시.
 * 팀에서 쓰는 코드를 여기에 등록 (미등록 시 라벨 정규식 폴백).
 */
const MAJOR_CODE_TO_SPECIALTY: Record<string, SpecialtyKind> = {
  MOVIE: 'movie',
  CINEMA: 'movie',
  FILM: 'movie',
  FOOD: 'food',
  MEAL: 'food',
  DINING: 'food',
  CAFE: 'food',
  SPORTS: 'sports',
  FITNESS: 'sports',
  WORKOUT: 'sports',
  /** PC 게임 모임 — 장소는 PC방 중심, Step2에서 타이틀 칩 선택 */
  PCGAME: 'sports',
};

/** `major_code`에 사람 읽기용 그룹명을 쓰는 경우(공백·& 등) — 토큰 맵과 별도 정확 일치 */
const MAJOR_GROUP_NAME_TO_SPECIALTY: Record<string, SpecialtyKind> = {
  'Eat & Drink': 'food',
  'Play & Vibe': 'sports',
  'Active & Life': 'sports',
  'Focus & Knowledge': 'knowledge',
};

/** 레거시 짧은 코드(MOVIE 등)인데 맵에 없을 때만 개발 경고 — 그룹명 문자열은 경고 생략 */
function isLegacyTokenMajorCode(s: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(s.trim());
}

/**
 * Firestore 카테고리 `label` 기준으로 Step 2 특화 카드 종류를 결정합니다.
 * (우선순위: 영화 → 맛집/카페 → 운동)
 */
export function resolveSpecialtyKind(label: string): SpecialtyKind | null {
  const L = label.trim();
  if (!L) return null;
  if (/영화|무비|시네마|시네|극장|OTT|넷플|왓챠|디즈니/.test(L)) return 'movie';
  if (/맛집|식사|레스토랑|밥|먹거리|고기|회식|식당|카페|커피|디저트|티타임|브런치/.test(L)) {
    return 'food';
  }
  if (/운동|헬스|러닝|런닝|등산|요가|헬창|짐|스포츠|크로스핏|수영/.test(L)) return 'sports';
  if (/스터디|북카페|토론|강연|세미나|워크숍|자격증|회화|북클럽|독서|카공|코딩|개발|밋업|네트워킹|학습|공부/.test(L)) {
    return 'knowledge';
  }
  return null;
}

/** `major_code` 우선, 없거나 미매핑이면 `label` 정규식 (`resolveSpecialtyKind`). */
export function resolveSpecialtyKindForCategory(category: Pick<Category, 'label' | 'majorCode'> | null): SpecialtyKind | null {
  if (!category) return null;
  const raw = typeof category.majorCode === 'string' ? category.majorCode.trim() : '';
  if (raw.length > 0) {
    const byGroup = MAJOR_GROUP_NAME_TO_SPECIALTY[raw];
    if (byGroup) return byGroup;
    const rawLower = raw.toLowerCase();
    for (const [k, v] of Object.entries(MAJOR_GROUP_NAME_TO_SPECIALTY)) {
      if (k.toLowerCase() === rawLower) return v;
    }
    const key = raw.toUpperCase();
    const byMajor = MAJOR_CODE_TO_SPECIALTY[key];
    if (byMajor) return byMajor;
    if (__DEV__ && isLegacyTokenMajorCode(raw)) {
      console.warn('[category-specialty] unknown legacy major_code token, falling back to label:', raw);
    }
  }
  return category.label ? resolveSpecialtyKind(category.label) : null;
}

export function isPlayAndVibeMajorCode(majorCode: string | null | undefined): boolean {
  return (majorCode ?? '').trim().toLowerCase() === 'play & vibe';
}

/** `meeting_categories.major_code` — PcGame (대소문자 무시) */
export function isPcGameMajorCode(majorCode: string | null | undefined): boolean {
  return (majorCode ?? '').trim().toLowerCase() === 'pcgame';
}

/** 모임 생성 Step2(특화 카드) 필요 여부 — Play & Vibe는 게임 종류, Active & Life는 활동 종류. 그 외 단독 스포츠는 Step2 없음 */
export function categoryNeedsSpecialty(category: Category | null): boolean {
  if (!category) return false;
  const sk = resolveSpecialtyKindForCategory(category);
  if (sk == null) return false;
  if (isPlayAndVibeMajorCode(category.majorCode)) return true;
  if (isPcGameMajorCode(category.majorCode)) return true;
  if (sk === 'sports' && !isActiveLifeMajorCode(category.majorCode)) return false;
  return true;
}

/** Step2 상단 배지 — `Active & Life` 대분류는 활동 종류 문구 */
export function isActiveLifeMajorCode(majorCode: string | null | undefined): boolean {
  return (majorCode ?? '').trim().toLowerCase() === 'active & life';
}

export function specialtyStepBadge(kind: SpecialtyKind, majorCode?: string | null): string {
  switch (kind) {
    case 'movie':
      return '영화 선택';
    case 'food':
      return '메뉴 성향';
    case 'sports':
      if (isPcGameMajorCode(majorCode)) return 'PC 게임';
      return isPlayAndVibeMajorCode(majorCode) ? '게임 종류' : '활동 종류';
    case 'knowledge':
      return '모임 성격';
    default:
      return '추가 정보';
  }
}
