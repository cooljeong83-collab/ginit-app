import { describe, expect, it } from 'vitest';

import { compareKoreanDisplayNames, koreanDisplayNameSortKey } from '@/src/lib/korean-display-name-sort';

describe('koreanDisplayNameSortKey', () => {
  it('strips trailing compatibility jamo for sort', () => {
    expect(koreanDisplayNameSortKey('쌍ㄱ')).toBe('쌍');
  });
});

describe('compareKoreanDisplayNames', () => {
  it('orders 쌍ㄱ after 사과 and before 아무 (가나다)', () => {
    expect(compareKoreanDisplayNames('쌍ㄱ', '사과')).toBeGreaterThan(0);
    expect(compareKoreanDisplayNames('쌍ㄱ', '아무')).toBeLessThan(0);
    expect(compareKoreanDisplayNames('김철수', '쌍ㄱ')).toBeLessThan(0);
  });

  it('sorts a mixed list in Korean syllable order', () => {
    const names = ['쌍ㄱ', '하늘', '가나다', '김철수', '아무', '사과'];
    expect([...names].sort(compareKoreanDisplayNames)).toEqual([
      '가나다',
      '김철수',
      '사과',
      '쌍ㄱ',
      '아무',
      '하늘',
    ]);
  });
});
