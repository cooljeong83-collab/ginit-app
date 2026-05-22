import { describe, expect, it } from 'vitest';

import {
  allowedPlaceBucketsForMeetingContext,
  filterSponsoredPlacesForMeetingContext,
  naverPlaceCategoryBucket,
  sponsoredPlaceMatchesMeetingContext,
} from '@/src/lib/promotions/sponsored-place-category-match';

describe('naverPlaceCategoryBucket', () => {
  it('maps PC방 to entertainment', () => {
    expect(naverPlaceCategoryBucket('PC방')).toBe('entertainment');
  });

  it('maps cafe labels', () => {
    expect(naverPlaceCategoryBucket('카페')).toBe('cafe');
  });
});

describe('sponsoredPlaceMatchesMeetingContext', () => {
  it('allows PC방 for PCGAME major', () => {
    expect(
      sponsoredPlaceMatchesMeetingContext(
        { category: 'PC방', placeName: '홍대 PC존' },
        { majorCode: 'PcGame', categoryLabel: 'PC 게임' },
      ),
    ).toBe(true);
  });

  it('rejects PC방 for Eat & Drink major', () => {
    expect(
      sponsoredPlaceMatchesMeetingContext(
        { category: 'PC방' },
        { majorCode: 'Eat & Drink', specialtyKind: 'food', categoryLabel: '카페' },
      ),
    ).toBe(false);
  });

  it('allows cafe for food specialty when major missing', () => {
    expect(
      sponsoredPlaceMatchesMeetingContext(
        { category: '카페' },
        { specialtyKind: 'food', categoryLabel: '카페 모임' },
      ),
    ).toBe(true);
  });

  it('rejects PC방 for food specialty', () => {
    expect(
      sponsoredPlaceMatchesMeetingContext(
        { category: 'PC방' },
        { specialtyKind: 'food', categoryLabel: '카페' },
      ),
    ).toBe(false);
  });

  it('rejects all when major and specialty unknown', () => {
    expect(allowedPlaceBucketsForMeetingContext({})).toBeNull();
    expect(
      sponsoredPlaceMatchesMeetingContext({ category: '카페' }, { categoryLabel: '기타' }),
    ).toBe(false);
  });
});

describe('filterSponsoredPlacesForMeetingContext', () => {
  it('filters mixed sponsored rows by major', () => {
    const rows = [
      { category: 'PC방', placeName: 'A' },
      { category: '카페', placeName: 'B' },
    ];
    const out = filterSponsoredPlacesForMeetingContext(rows, {
      majorCode: 'Eat & Drink',
      specialtyKind: 'food',
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.placeName).toBe('B');
  });
});
