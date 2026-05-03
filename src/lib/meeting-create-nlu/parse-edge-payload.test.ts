import { describe, expect, it } from 'vitest';

import type { Category } from '@/src/lib/categories';
import { parseMeetingCreateNluPayload } from '@/src/lib/meeting-create-nlu/parse-edge-payload';

const cats: Category[] = [
  { id: 'cat-food', label: '식사', emoji: '🍽', order: 1, majorCode: 'food' },
];

describe('parseMeetingCreateNluPayload', () => {
  it('accepts valid edge-shaped payload', () => {
    const now = new Date('2026-05-03T12:00:00');
    const r = parseMeetingCreateNluPayload(
      cats,
      {
        categoryId: 'cat-food',
        title: '저녁 식사',
        minParticipants: 2,
        maxParticipants: 4,
        scheduleYmd: '2026-05-04',
        scheduleHm: '19:00',
        placeAutoPickQuery: '강남역 한식',
        suggestedIsPublic: true,
        publicMeetingDetails: { ageLimit: ['FORTY_PLUS'] },
      },
      now,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.categoryId).toBe('cat-food');
    expect(r.plan.autoSchedule).toEqual({ ymd: '2026-05-04', hm: '19:00' });
    expect(r.plan.publicMeetingDetailsPartial?.ageLimit).toEqual(['FORTY_PLUS']);
  });

  it('rejects missing schedule', () => {
    const r = parseMeetingCreateNluPayload(
      cats,
      {
        categoryId: 'cat-food',
        title: 'x',
        minParticipants: 2,
        maxParticipants: 4,
      },
      new Date(),
    );
    expect(r.ok).toBe(false);
  });
});
