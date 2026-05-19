import { describe, expect, it } from 'vitest';

import { formatFeedReviewLocationDetail } from '@/src/lib/feed-meeting-review-card-format';

describe('formatFeedReviewLocationDetail', () => {
  it('strips leading 도·시·구 administrative tokens', () => {
    expect(formatFeedReviewLocationDetail('서울특별시 영등포구 국제금융로 10')).toBe('국제금융로 10');
    expect(formatFeedReviewLocationDetail('경기도 성남시 분당구 판교역로 235')).toBe('판교역로 235');
    expect(formatFeedReviewLocationDetail('부산광역시 해운대구 해운대해변로 264')).toBe('해운대해변로 264');
  });

  it('returns null when only administrative parts remain', () => {
    expect(formatFeedReviewLocationDetail('영등포구')).toBeNull();
    expect(formatFeedReviewLocationDetail('서울특별시 강남구')).toBeNull();
  });

  it('keeps detail-only addresses', () => {
    expect(formatFeedReviewLocationDetail('가로수길 5')).toBe('가로수길 5');
  });
});
