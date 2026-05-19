import { describe, expect, it } from 'vitest';

import { mapNaverCategoryToReviewCategory } from '@/src/lib/meeting-review/meeting-review-category';
import { getKeywordsForCategory, MAX_MEETING_REVIEW_KEYWORDS } from '@/src/lib/meeting-review/meeting-review-keywords';

describe('mapNaverCategoryToReviewCategory', () => {
  it('maps cafe labels', () => {
    expect(mapNaverCategoryToReviewCategory('카페')).toBe('cafe');
    expect(mapNaverCategoryToReviewCategory('커피전문점')).toBe('cafe');
  });

  it('maps bar labels', () => {
    expect(mapNaverCategoryToReviewCategory('이자카야')).toBe('bar');
    expect(mapNaverCategoryToReviewCategory('와인바')).toBe('bar');
  });

  it('defaults to restaurant', () => {
    expect(mapNaverCategoryToReviewCategory('한식')).toBe('restaurant');
    expect(mapNaverCategoryToReviewCategory('')).toBe('restaurant');
  });
});

describe('getKeywordsForCategory', () => {
  it('includes common keywords for restaurant', () => {
    const list = getKeywordsForCategory('restaurant');
    expect(list).toContain('모임 장소로 딱!');
    expect(list.length).toBeGreaterThan(5);
  });

  it('enforces max selection constant', () => {
    expect(MAX_MEETING_REVIEW_KEYWORDS).toBe(3);
  });
});
