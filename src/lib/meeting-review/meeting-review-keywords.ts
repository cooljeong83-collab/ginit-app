export type MeetingReviewKeywordCategory =
  | 'restaurant'
  | 'cafe'
  | 'bar'
  | 'sports'
  | 'entertainment'
  | 'movie'
  | 'culture'
  | 'knowledge'
  | 'common';

export const MEETING_REVIEW_KEYWORD_CATEGORY_LABELS: Record<
  Exclude<MeetingReviewKeywordCategory, 'common'>,
  string
> = {
  restaurant: '음식점',
  cafe: '카페',
  bar: '술집',
  sports: '운동·스포츠',
  entertainment: '놀이·오락',
  movie: '영화관',
  culture: '문화·전시',
  knowledge: '스터디·카공',
};

export const MEETING_REVIEW_KEYWORDS_BY_CATEGORY = {
  restaurant: [
    '음식이 맛있어요',
    '양도 푸짐해요',
    '재료가 신선해요',
    '메뉴가 다양해요',
    '간이 적절해요',
  ],
  cafe: ['커피가 맛있어요', '디저트가 다양해요', '분위기가 예뻐요', '공부하기 좋아요', '조용해요'],
  bar: ['안주가 맛있어요', '술 종류가 많아요', '대화하기 좋아요', '분위기가 힙해요', '단체석 완비'],
  sports: [
    '시설이 깔끔해요',
    '장비·룸 상태가 좋아요',
    '예약·이용이 편해요',
    '가격이 합리해요',
    '친구들이랑 즐기기 좋아요',
  ],
  entertainment: [
    '방·시설이 넓어요',
    '기기·장비가 최신이에요',
    '대기 없이 이용하기 좋아요',
    '재미있어요',
    '직원이 친절해요',
  ],
  movie: [
    '좌석이 편해요',
    '음향·화질이 좋아요',
    '관람 환경이 쾌적해요',
    '주차·교통이 편해요',
    '함께 보기 좋아요',
  ],
  culture: [
    '전시 구성이 알차요',
    '관람 동선이 좋아요',
    '설명·안내가 도움돼요',
    '분위기가 좋아요',
    '다시 보고 싶어요',
  ],
  knowledge: [
    '조용해서 집중돼요',
    '좌석·자리가 편해요',
    '와이파이·콘센트 좋아요',
    '분위기가 좋아요',
    '오래 머물기 좋아요',
  ],
  common: ['모임 장소로 딱!', '친구들이랑 다시 올래', '결제하기 편함'],
} as const;

export const MAX_MEETING_REVIEW_KEYWORDS = 3;

const SPECIFIC_CATEGORIES = [
  'restaurant',
  'cafe',
  'bar',
  'sports',
  'entertainment',
  'movie',
  'culture',
  'knowledge',
] as const satisfies readonly Exclude<MeetingReviewKeywordCategory, 'common'>[];

export const MEETING_REVIEW_ALL_ALLOWED_KEYWORDS: readonly string[] = [
  ...SPECIFIC_CATEGORIES.flatMap((c) => [...MEETING_REVIEW_KEYWORDS_BY_CATEGORY[c]]),
  ...MEETING_REVIEW_KEYWORDS_BY_CATEGORY.common,
];

/** 업종 칩 + 지닛 공통 키워드를 합친 선택 목록(중복 제거) */
export function getKeywordsForCategory(category: MeetingReviewKeywordCategory): readonly string[] {
  if (category === 'common') {
    return MEETING_REVIEW_KEYWORDS_BY_CATEGORY.common;
  }
  const specific = MEETING_REVIEW_KEYWORDS_BY_CATEGORY[category];
  const merged = [...specific, ...MEETING_REVIEW_KEYWORDS_BY_CATEGORY.common];
  return [...new Set(merged)];
}
