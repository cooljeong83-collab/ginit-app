/**
 * 모임 생성 NLU: 카테고리별 발화 키워드·장소 재촉(nudge) 예시.
 * - `categoryIds`: Firestore/Supabase `meeting_categories.id` (시드 `generated_categories.sql` 6행 + 운영 확장 시 id 추가).
 * - `labelIncludes`: id가 환경마다 다를 때 `Category.label` 부분 일치로 매핑.
 */
import type { Category } from '@/src/lib/categories';

export type MeetingCreateNluRegistryRow = {
  categoryIds: readonly string[];
  /** `category.label` 에 이 문자열 중 하나가 포함되면 매칭 */
  labelIncludes: readonly string[];
  utteranceKeywords: readonly string[];
  /** 동점 시 낮을수록 우선(키워드 점수 동일 시) */
  tieBreakOrder: number;
  /** schedule+headcount+place 묶음 재촉 시 장소 예시 문구 */
  placeNudgeCombined: string;
  /** place 결손만 있을 때 */
  placeNudgePlaceOnly: string;
};

/** 시드 `supabase/seed/generated_categories.sql` + 라벨 기반 6종(운영에서 id가 달라도 라벨로 매칭) */
export const MEETING_CREATE_NLU_REGISTRY: readonly MeetingCreateNluRegistryRow[] = [
  {
    categoryIds: ['xYAgS71J2K5t9x4PfTkJ'],
    labelIncludes: ['벙개', '번개'],
    utteranceKeywords: ['벙개', '번개', '술번개', '첫만남', '소개팅', '미팅'],
    tieBreakOrder: 80,
    placeNudgeCombined: '몇 분이 언제 모이실 건지, 그리고 어느 동네·역 근처에서 만나실지 알려 주세요.',
    placeNudgePlaceOnly: '어느 동네나 역 근처에서 모이실 건지 알려 주세요.',
  },
  {
    categoryIds: ['ymihqIsLyDJnVDbVmgi7'],
    labelIncludes: ['식사'],
    utteranceKeywords: [
      '식사',
      '밥',
      '밥먹',
      '저녁',
      '점심',
      '아침',
      '브런치',
      '회식',
      '맛집',
      '고기',
      '뷔페',
      '레스토랑',
      '한우',
      '삼겹살',
      '야식',
    ],
    tieBreakOrder: 40,
    placeNudgeCombined:
      '몇 분이 언제 모이실 건지, 그리고 어느 동네·맛집 근처에서 만나실지(한식·일식처럼 성향만 말씀해 주셔도 돼요) 알려 주세요.',
    placeNudgePlaceOnly: '어느 동네나 맛집 근처에서 모이실 건지 알려 주세요.',
  },
  {
    categoryIds: ['snMorugrx3Sh3uvBlu2N'],
    labelIncludes: ['커피'],
    utteranceKeywords: ['커피', '라떼', '아메리카노', '카페인', '디저트', '케이크', '티타임', '차 마실'],
    tieBreakOrder: 15,
    placeNudgeCombined:
      '몇 분이 언제 모이실 건지, 그리고 어느 동네·카페 거리에서 만나실지 알려 주세요.',
    placeNudgePlaceOnly: '어느 동네나 분위기 좋은 카페·브런치집 근처인지 알려 주세요.',
  },
  {
    categoryIds: ['sRI7BKMxlPfE9MrtuS0G'],
    labelIncludes: ['영화'],
    utteranceKeywords: [
      '영화',
      '극장',
      '영화관',
      '시네마',
      '무비',
      '상영',
      '관람',
      '넷플',
      '왓챠',
      '디즈니',
      'ott',
      '티켓',
    ],
    tieBreakOrder: 10,
    placeNudgeCombined:
      '몇 분이 언제 모이실 건지, 그리고 어느 영화관·지역(브랜드나 역 이름)에서 보실지 알려 주세요.',
    placeNudgePlaceOnly: '어느 영화관이나 동네 극장에서 모이실 건지 알려 주세요.',
  },
  {
    categoryIds: ['uUnuq6A7Aal9fw3lLOQ3'],
    labelIncludes: ['운동'],
    utteranceKeywords: [
      '운동',
      '러닝',
      '런닝',
      '조깅',
      '헬스',
      '수영',
      '등산',
      '클라이밍',
      '요가',
      '필라테스',
      '크로스핏',
      '풋살',
      '축구',
      '배드민턴',
      '테니스',
      '자전거',
      '라이딩',
      '산책',
      '워킹',
      '댄스',
    ],
    tieBreakOrder: 25,
    placeNudgeCombined:
      '몇 분이 언제 모이실 건지, 그리고 어느 공원·트랙·헬스장·구장 근처에서 만나실지 알려 주세요.',
    placeNudgePlaceOnly: '어느 공원, 러닝 코스, 헬스장·구장 근처에서 모이실 건지 알려 주세요.',
  },
  {
    categoryIds: ['yqbX78qBYbnocQZJi6dI'],
    labelIncludes: ['스터디'],
    utteranceKeywords: [
      '스터디',
      '공부',
      '독서',
      '카공',
      '코딩',
      '개발',
      '자격증',
      '시험',
      '토론',
      '북클럽',
      '워크숍',
      '강연',
      '세미나',
      '멘토링',
    ],
    tieBreakOrder: 35,
    placeNudgeCombined:
      '몇 분이 언제 모이실 건지, 그리고 어느 스터디 카페·도서관·코워킹 근처에서 만나실지 알려 주세요.',
    placeNudgePlaceOnly: '어느 스터디 카페·도서관·코워킹 근처에서 모이실 건지 알려 주세요.',
  },
  /* --- 아래 6행: 운영에서 자주 쓰는 라벨( id 는 환경별 ) — labelIncludes 로만 매칭 --- */
  {
    categoryIds: [],
    labelIncludes: ['게임', 'e스포츠', '보드게임'],
    utteranceKeywords: ['게임', '롤', '배그', '발로', '보드게임', '방탈출', '볼링', '오락실', 'pc방', '피시방', '님순'],
    tieBreakOrder: 30,
    placeNudgeCombined: '몇 분이 언제 모이실 건지, 그리고 어느 게임장·카페·PC방 근처에서 만나실지 알려 주세요.',
    placeNudgePlaceOnly: '어느 게임 카페·PC방·오락실 근처에서 모이실 건지 알려 주세요.',
  },
  {
    categoryIds: [],
    labelIncludes: ['등산', '트레킹', '아웃도어'],
    utteranceKeywords: ['등산', '트레킹', '야영', '캠핑', '계곡', '산행'],
    tieBreakOrder: 26,
    placeNudgeCombined: '몇 분이 언제 모이실 건지, 그리고 어느 산·입구·주차장에서 만나실지 알려 주세요.',
    placeNudgePlaceOnly: '어느 산이나 등산로 입구·주차장에서 모이실 건지 알려 주세요.',
  },
  {
    categoryIds: [],
    labelIncludes: ['여행'],
    utteranceKeywords: ['여행', '당일치기', '근교', '기차', 'ktx', '고속버스', '투어'],
    tieBreakOrder: 45,
    placeNudgeCombined: '몇 분이 언제 떠나실 건지, 그리고 출발 지역·집합 장소를 알려 주세요.',
    placeNudgePlaceOnly: '어디서 집합하실 건지(역·터미널·주차장 등) 알려 주세요.',
  },
  {
    categoryIds: [],
    labelIncludes: ['공연', '콘서트', '뮤지컬', '문화'],
    utteranceKeywords: ['공연', '콘서트', '뮤지컬', '연극', '페스티벌', '티켓'],
    tieBreakOrder: 20,
    placeNudgeCombined: '몇 분이 언제 모이실 건지, 그리고 어느 공연장·홀 근처에서 만나실지 알려 주세요.',
    placeNudgePlaceOnly: '어느 공연장·공연장역 근처에서 모이실 건지 알려 주세요.',
  },
  {
    categoryIds: [],
    labelIncludes: ['봉사'],
    utteranceKeywords: ['봉사', '자원봉사', '기부', '캠페인'],
    tieBreakOrder: 50,
    placeNudgeCombined: '몇 분이 언제 모이실 건지, 그리고 봉사 장소·집합 위치를 알려 주세요.',
    placeNudgePlaceOnly: '봉사 집합 장소나 동네를 알려 주세요.',
  },
  {
    categoryIds: [],
    labelIncludes: ['골프'],
    utteranceKeywords: ['골프', '스크린골프', '파크골프', '드라이빙레인지'],
    tieBreakOrder: 27,
    placeNudgeCombined: '몇 분이 언제 모이실 건지, 그리고 어느 골프장·연습장 근처에서 만나실지 알려 주세요.',
    placeNudgePlaceOnly: '어느 골프장·스크린골프장 근처에서 모이실 건지 알려 주세요.',
  },
];

export function findMeetingCreateNluRegistryRow(
  cat: Pick<Category, 'id' | 'label'> | null,
): MeetingCreateNluRegistryRow | null {
  if (!cat) return null;
  const id = cat.id.trim();
  const label = cat.label.normalize('NFKC').trim();
  let best: MeetingCreateNluRegistryRow | null = null;
  for (const row of MEETING_CREATE_NLU_REGISTRY) {
    if (row.categoryIds.some((x) => x.trim() === id)) {
      if (!best || row.tieBreakOrder < best.tieBreakOrder) best = row;
    }
  }
  if (best) return best;
  for (const row of MEETING_CREATE_NLU_REGISTRY) {
    for (const frag of row.labelIncludes) {
      const f = frag.normalize('NFKC').trim();
      if (!f) continue;
      if (label.includes(f) || f.includes(label)) {
        if (!best || row.tieBreakOrder < best.tieBreakOrder) best = row;
        break;
      }
    }
  }
  return best;
}

export function registryUtteranceKeywordBonus(textNorm: string, cat: Category): number {
  const row = findMeetingCreateNluRegistryRow(cat);
  if (!row) return 0;
  let bonus = 0;
  for (const kw of row.utteranceKeywords) {
    const k = kw.normalize('NFKC').trim();
    if (k.length >= 2 && textNorm.includes(k)) {
      bonus += k.length * 2;
    }
  }
  return bonus;
}

const DEFAULT_COMBINED =
  '몇 분이 언제 모이실 건지, 그리고 어느 쪽 장소에서 만나실지(동네 이름이나 분위기 좋은 카페·포차처럼 말씀만 해 주셔도 돼요) 알려 주세요.';
const DEFAULT_PLACE_ONLY = '어느 쪽에서 모이실 건지(동네나 분위기 좋은 카페·키즈카페·바 등) 알려 주세요.';

export function getMeetingCreateNluPlaceNudgeCombined(cat: Pick<Category, 'id' | 'label'> | null): string {
  return findMeetingCreateNluRegistryRow(cat)?.placeNudgeCombined ?? DEFAULT_COMBINED;
}

export function getMeetingCreateNluPlaceNudgePlaceOnly(cat: Pick<Category, 'id' | 'label'> | null): string {
  return findMeetingCreateNluRegistryRow(cat)?.placeNudgePlaceOnly ?? DEFAULT_PLACE_ONLY;
}

/** 커피 전용 카테고리 id (시드) — 발화에 커피 계열이 있으면 식사 대신 우선 */
export const MEETING_CREATE_COFFEE_CATEGORY_ID = 'snMorugrx3Sh3uvBlu2N';
export const MEETING_CREATE_MEAL_CATEGORY_ID = 'ymihqIsLyDJnVDbVmgi7';
