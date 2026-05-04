import { describe, expect, it } from 'vitest';

import type { Category } from '@/src/lib/categories';
import {
  deriveMeetingTitleFromOpeningUtterance,
  sanitizeMeetingCreateNluPatchForVenueFollowUp,
} from './opening-utterance-meeting-title';

const stubCategories: Category[] = [
  { id: 'c1', label: '스터디', emoji: '📚', order: 0, majorCode: 'Focus & Knowledge' },
];

describe('deriveMeetingTitleFromOpeningUtterance', () => {
  it('strips relative day, daypart, and time before place phrase', () => {
    expect(deriveMeetingTitleFromOpeningUtterance('내일 밤 9시 영등포역 2:2 미팅')).toBe('영등포역 2:2 미팅');
  });

  it('returns trimmed remainder when nothing left after stripping', () => {
    expect(deriveMeetingTitleFromOpeningUtterance('내일').length).toBeGreaterThan(0);
  });

  it('handles afternoon time phrase', () => {
    const t = deriveMeetingTitleFromOpeningUtterance('모레 오후 3시 강남역 러닝');
    expect(t).toContain('강남역');
    expect(t).toContain('러닝');
  });
});

describe('sanitizeMeetingCreateNluPatchForVenueFollowUp', () => {
  const now = new Date('2026-05-03');

  it('removes title and 이름 on second turn when only placeVenue is missing and place is station-only', () => {
    const beforeAcc = {
      categoryId: 'c1',
      scheduleYmd: '2026-05-05',
      scheduleHm: '21:00',
      minParticipants: 2,
      maxParticipants: 2,
      placeAutoPickQuery: '영등포역',
    };
    const patch = { title: '술집', placeAutoPickQuery: '영등포역 술집', 장소: '영등포역 술집' };
    const out = sanitizeMeetingCreateNluPatchForVenueFollowUp(patch, {
      categories: stubCategories,
      beforeAcc,
      raw: '술집',
      now,
      priorUserTurns: 1,
    });
    expect(out.title).toBeUndefined();
    expect(out['이름']).toBeUndefined();
    expect(out.placeAutoPickQuery).toBe('영등포역 술집');
  });

  it('does not strip on first user turn', () => {
    const beforeAcc = {
      categoryId: 'c1',
      placeAutoPickQuery: '영등포역',
    };
    const patch = { title: 'x' };
    const out = sanitizeMeetingCreateNluPatchForVenueFollowUp(patch, {
      categories: stubCategories,
      beforeAcc,
      raw: '술집',
      now,
      priorUserTurns: 0,
    });
    expect(out.title).toBe('x');
  });

  it('keeps title when user mentions 제목', () => {
    const beforeAcc = {
      categoryId: 'c1',
      scheduleYmd: '2026-05-05',
      scheduleHm: '21:00',
      minParticipants: 2,
      maxParticipants: 2,
      placeAutoPickQuery: '영등포역',
    };
    const patch = { title: '친구들 술자리' };
    const out = sanitizeMeetingCreateNluPatchForVenueFollowUp(patch, {
      categories: stubCategories,
      beforeAcc,
      raw: '제목은 친구들 술자리로 해줘',
      now,
      priorUserTurns: 1,
    });
    expect(out.title).toBe('친구들 술자리');
  });
});
