import { describe, expect, it, beforeEach } from 'vitest';

import { resetAppPoliciesCacheForTests } from '../app-policies-store';
import type { Meeting } from '../meetings';
import { aggregateUserMeetingHabits } from './aggregate-user-meeting-habits';

beforeEach(() => {
  resetAppPoliciesCacheForTests();
});

describe('aggregateUserMeetingHabits', () => {
  it('returns null for empty list', () => {
    expect(aggregateUserMeetingHabits([], new Date('2026-05-03T12:00:00'), 'u1')).toBeNull();
  });

  it('weights confirmed place chip', () => {
    const m: Meeting = {
      id: 'm1',
      title: '등산',
      location: '',
      description: '',
      capacity: 10,
      scheduleConfirmed: true,
      confirmedPlaceChipId: 'p0',
      placeCandidates: [{ id: 'p0', placeName: '북한산 입구', address: '서울', latitude: 0, longitude: 0 }],
      scheduleDate: '2026-05-02',
      categoryLabel: '등산',
      participantVoteLog: [],
    };
    const now = new Date('2026-05-03T12:00:00');
    const agg = aggregateUserMeetingHabits([m], now, 'u1');
    expect(agg).not.toBeNull();
    expect(agg!.topPlaces[0]?.displayQuery).toContain('북한산');
    expect(agg!.topPlaces[0]?.score).toBeGreaterThan(0);
  });

  it('detects weekend-heavy category', () => {
    const mk = (d: string, lab: string): Meeting => ({
      id: d,
      title: lab,
      location: '',
      description: '',
      capacity: 4,
      scheduleDate: d,
      categoryLabel: lab,
      participantVoteLog: [],
    });
    const sat = '2026-05-02';
    const sun = '2026-05-03';
    const meetings = [mk(sat, '등산'), mk(sat, '등산'), mk(sun, '등산')];
    const agg = aggregateUserMeetingHabits(meetings, new Date('2026-05-04T12:00:00'), 'u1');
    expect(agg?.weekendDayPortion).toBeGreaterThan(0.5);
    expect(agg?.weekendTopCategoryLabel).toBe('등산');
  });
});
