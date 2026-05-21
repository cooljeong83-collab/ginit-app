import { describe, expect, it } from 'vitest';

import {
  adFreeUntilToIsoString,
  isProfileAdFree,
  parseAdFreeUntil,
} from '@/src/lib/ads/is-profile-ad-free';

describe('parseAdFreeUntil', () => {
  it('parses ISO string', () => {
    const d = parseAdFreeUntil('2030-01-01T00:00:00.000Z');
    expect(d?.toISOString()).toBe('2030-01-01T00:00:00.000Z');
  });

  it('returns null for empty', () => {
    expect(parseAdFreeUntil(null)).toBeNull();
    expect(parseAdFreeUntil('')).toBeNull();
  });
});

describe('adFreeUntilToIsoString', () => {
  it('reads snake_case from Supabase row', () => {
    expect(adFreeUntilToIsoString({ ad_free_until: '2030-01-01T00:00:00.000Z' })).toBe(
      '2030-01-01T00:00:00.000Z',
    );
  });

  it('reads camelCase from mapped shape', () => {
    expect(adFreeUntilToIsoString({ adFreeUntil: '2030-06-01T12:00:00.000Z' })).toBe(
      '2030-06-01T12:00:00.000Z',
    );
  });
});

describe('isProfileAdFree', () => {
  const now = Date.parse('2026-05-21T12:00:00.000Z');

  it('true when ad_free_until is in the future', () => {
    expect(
      isProfileAdFree({ adFreeUntil: '2026-05-22T00:00:00.000Z' }, now),
    ).toBe(true);
  });

  it('false when null or past', () => {
    expect(isProfileAdFree({ adFreeUntil: null }, now)).toBe(false);
    expect(isProfileAdFree({ adFreeUntil: '2020-01-01T00:00:00.000Z' }, now)).toBe(false);
  });

  it('false when profile missing', () => {
    expect(isProfileAdFree(null, now)).toBe(false);
  });
});
