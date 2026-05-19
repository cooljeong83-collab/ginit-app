import { describe, expect, it } from 'vitest';

import {
  doesReceiptStoreMatchPlaceLabels,
  isSettlementReceiptPlaceVerified,
  settlementStoreLabelsMatch,
} from '@/src/lib/settlement-receipt-place-match';
import type { MeetingReviewPlaceContext } from '@/src/lib/meeting-review/meeting-review-place-context';

const place: MeetingReviewPlaceContext = {
  placeName: '지닛 카페 강남점',
  category: '카페',
  address: '서울 강남구 테헤란로 1',
  naverPlaceLink: null,
  visitDateLabel: '2026.05.11',
  photoUrl: null,
  placeId: 'place-1',
  chipId: 'chip-1',
  keywordCategory: 'cafe',
};

describe('settlement-receipt-place-match', () => {
  it('matches when receipt store contains place name core', () => {
    expect(settlementStoreLabelsMatch('지닛카페 강남역점', '지닛 카페 강남점')).toBe(true);
    expect(doesReceiptStoreMatchPlaceLabels('(주)지닛카페강남점', [place.placeName])).toBe(true);
  });

  it('rejects unrelated store names', () => {
    expect(settlementStoreLabelsMatch('다른식당 본점', '지닛 카페 강남점')).toBe(false);
  });

  it('is verified when any receipt matches place', () => {
    expect(
      isSettlementReceiptPlaceVerified(
        [
          {
            receiptId: 'r1',
            imageUrl: 'https://example.com/a.jpg',
            amountWon: 10000,
            storeName: '스타벅스 강남역점',
            bizNum: null,
            receiptDateText: null,
            isVerified: true,
            status: 'active',
          },
        ],
        { ...place, placeName: '스타벅스 강남점' },
      ),
    ).toBe(true);
  });
});
