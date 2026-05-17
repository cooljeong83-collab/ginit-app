import { describe, expect, it } from 'vitest';

import { searchKoreaInterestDistricts } from '@/src/lib/korea-interest-districts';

describe('searchKoreaInterestDistricts', () => {
  it('동 이름으로 서울 행정구를 찾는다', () => {
    const hits = searchKoreaInterestDistricts('역삼동', []);
    expect(hits.some((h) => h.key === '강남구')).toBe(true);
  });

  it('동 접미사 없이 동 이름 일부만 입력해도 행정구를 찾는다', () => {
    const hits = searchKoreaInterestDistricts('역삼', []);
    expect(hits.some((h) => h.key === '강남구')).toBe(true);
  });

  it('광역시 동 이름으로 해당 구를 찾는다', () => {
    const hits = searchKoreaInterestDistricts('우동', []);
    expect(hits.some((h) => h.key === '부산 해운대구')).toBe(true);
  });

  it('시·구가 있는 도시의 동으로 행정구를 찾는다', () => {
    const hits = searchKoreaInterestDistricts('파장동', []);
    expect(hits.some((h) => h.key === '수원 장안구')).toBe(true);
  });

  it('기존 구 이름 검색은 그대로 동작한다', () => {
    const hits = searchKoreaInterestDistricts('영등포구', []);
    expect(hits.some((h) => h.key === '영등포구')).toBe(true);
  });
});
