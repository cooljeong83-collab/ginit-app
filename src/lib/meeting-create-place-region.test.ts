import { describe, expect, it } from 'vitest';

import {
  buildPlaceRegionHaystack,
  gatePlaceAgainstRegisteredInterestRegions,
  placeMatchesAnyRegisteredInterestRegion,
  placeMatchesInterestRegion,
} from './meeting-create-place-region';

/** 강남구 bbox 내부 대표 좌표 */
const GANGNAM_LAT = 37.5011;
const GANGNAM_LNG = 127.0264;

/** 영등포구 bbox 내부 대표 좌표 */
const YEONGDEUNGPO_LAT = 37.5263;
const YEONGDEUNGPO_LNG = 126.8962;

describe('meeting-create-place-region', () => {
  it('buildPlaceRegionHaystack joins place name and address', () => {
    expect(buildPlaceRegionHaystack('카페', '서울 강남구 테헤란로 1')).toBe('카페 서울 강남구 테헤란로 1');
  });

  it('matches Seoul gu by address text', () => {
    expect(
      placeMatchesInterestRegion(
        { placeName: '모임 장소', address: '서울특별시 강남구 테헤란로 152' },
        '강남구',
      ),
    ).toBe(true);
    expect(
      placeMatchesInterestRegion(
        { placeName: '모임 장소', address: '서울특별시 송파구 올림픽로 300' },
        '강남구',
      ),
    ).toBe(false);
  });

  it('matches Seoul gu by coordinates when address lacks gu', () => {
    expect(
      placeMatchesInterestRegion(
        { placeName: '카페', address: '테헤란로 152', latitude: GANGNAM_LAT, longitude: GANGNAM_LNG },
        '강남구',
      ),
    ).toBe(true);
  });

  it('matches two-token metro region (인천 서구)', () => {
    expect(
      placeMatchesInterestRegion(
        { placeName: '카페', address: '인천광역시 서구 봉오대로 158' },
        '인천 서구',
      ),
    ).toBe(true);
    expect(
      placeMatchesInterestRegion(
        { placeName: '카페', address: '인천광역시 남동구 구월동' },
        '인천 서구',
      ),
    ).toBe(false);
  });

  it('placeMatchesAnyRegisteredInterestRegion is OR across regions', () => {
    const regions = ['강남구', '영등포구'] as const;
    expect(
      placeMatchesAnyRegisteredInterestRegion(
        { placeName: 'A', address: '서울 강남구 역삼동' },
        regions,
      ),
    ).toBe(true);
    expect(
      placeMatchesAnyRegisteredInterestRegion(
        { placeName: 'B', address: '서울 영등포구 여의도동', latitude: YEONGDEUNGPO_LAT, longitude: YEONGDEUNGPO_LNG },
        regions,
      ),
    ).toBe(true);
    expect(
      placeMatchesAnyRegisteredInterestRegion(
        { placeName: 'C', address: '서울 송파구 잠실동' },
        regions,
      ),
    ).toBe(false);
  });

  it('returns false when registered list is empty', () => {
    expect(placeMatchesAnyRegisteredInterestRegion({ address: '서울 강남구' }, [])).toBe(false);
  });

  it('gate blocks empty registration list', () => {
    const gate = gatePlaceAgainstRegisteredInterestRegions({ address: '서울 강남구' }, []);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.title).toBe('관심 지역 필요');
    }
  });

  it('gate blocks place outside all registered regions', () => {
    const gate = gatePlaceAgainstRegisteredInterestRegions(
      { placeName: 'X', address: '서울 송파구 올림픽로' },
      ['강남구', '영등포구'],
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.title).toBe('관심 지역 밖 장소');
      expect(gate.message).toContain('관심 지역');
    }
  });

  it('gate allows place in any registered region', () => {
    const gate = gatePlaceAgainstRegisteredInterestRegions(
      { placeName: 'Y', address: '서울 영등포구 여의동로', latitude: YEONGDEUNGPO_LAT, longitude: YEONGDEUNGPO_LNG },
      ['강남구', '영등포구'],
    );
    expect(gate.ok).toBe(true);
  });
});
