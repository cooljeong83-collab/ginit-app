export type MeetingReviewKeywordCategory = 'restaurant' | 'cafe' | 'bar' | 'common';

export const MEETING_REVIEW_KEYWORD_CATEGORY_LABELS: Record<
  Exclude<MeetingReviewKeywordCategory, 'common'>,
  string
> = {
  restaurant: '음식점',
  cafe: '카페',
  bar: '술집',
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
  common: ['모임 장소로 딱!', '친구들이랑 다시 올래', '결제하기 편함'],
} as const;

export const MAX_MEETING_REVIEW_KEYWORDS = 3;

export const MEETING_REVIEW_ALL_ALLOWED_KEYWORDS: readonly string[] = [
  ...MEETING_REVIEW_KEYWORDS_BY_CATEGORY.restaurant,
  ...MEETING_REVIEW_KEYWORDS_BY_CATEGORY.cafe,
  ...MEETING_REVIEW_KEYWORDS_BY_CATEGORY.bar,
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
