import { describe, expect, it } from 'vitest';

import { mapNaverCategoryToReviewCategory } from '@/src/lib/meeting-review/meeting-review-category';
import {
  getKeywordsForCategory,
  getPinnedFormKeywords,
  getReviewFormKeywordOptions,
  MAX_MEETING_REVIEW_KEYWORDS,
} from '@/src/lib/meeting-review/meeting-review-keywords';

describe('mapNaverCategoryToReviewCategory', () => {
  it('maps cafe labels', () => {
    expect(mapNaverCategoryToReviewCategory('카페')).toBe('cafe');
    expect(mapNaverCategoryToReviewCategory('커피전문점')).toBe('cafe');
  });

  it('maps bar labels', () => {
    expect(mapNaverCategoryToReviewCategory('이자카야')).toBe('bar');
    expect(mapNaverCategoryToReviewCategory('와인바')).toBe('bar');
  });

  it('maps restaurant labels', () => {
    expect(mapNaverCategoryToReviewCategory('한식')).toBe('restaurant');
  });

  it('maps screen golf to sports', () => {
    expect(mapNaverCategoryToReviewCategory('스크린골프장')).toBe('sports');
    expect(mapNaverCategoryToReviewCategory(null, '판교 스크린골프존')).toBe('sports');
  });

  it('maps entertainment venues', () => {
    expect(mapNaverCategoryToReviewCategory('PC방')).toBe('entertainment');
    expect(mapNaverCategoryToReviewCategory('노래방')).toBe('entertainment');
  });

  it('defaults to common when unknown', () => {
    expect(mapNaverCategoryToReviewCategory('')).toBe('common');
    expect(mapNaverCategoryToReviewCategory(null, 'OO 모임룸')).toBe('common');
  });
});

describe('getKeywordsForCategory', () => {
  it('includes common keywords for restaurant', () => {
    const list = getKeywordsForCategory('restaurant');
    expect(list).toContain('모임 장소로 딱!');
    expect(list.length).toBeGreaterThan(5);
  });

  it('uses sports-specific keywords for screen golf category', () => {
    const list = getKeywordsForCategory('sports');
    expect(list).toContain('장비·룸 상태가 좋아요');
    expect(list).not.toContain('음식이 맛있어요');
  });

  it('common category has only shared keywords', () => {
    const list = getKeywordsForCategory('common');
    expect(list).toEqual(['모임 장소로 딱!', '친구들이랑 다시 올래', '결제하기 편함']);
  });

  it('enforces max selection constant', () => {
    expect(MAX_MEETING_REVIEW_KEYWORDS).toBe(3);
  });

  it('appends pinned keywords missing from current category chips', () => {
    const pinned = getPinnedFormKeywords('common', ['음식이 맛있어요', '모임 장소로 딱!']);
    expect(pinned).toEqual(['음식이 맛있어요']);
    const options = getReviewFormKeywordOptions('common', pinned);
    expect(options).toContain('모임 장소로 딱!');
    expect(options).toContain('음식이 맛있어요');
  });

  it('keeps pinned chips visible after user deselects them', () => {
    const pinned = getPinnedFormKeywords('common', ['음식이 맛있어요']);
    const options = getReviewFormKeywordOptions('common', pinned);
    expect(options).toContain('음식이 맛있어요');
  });
});
