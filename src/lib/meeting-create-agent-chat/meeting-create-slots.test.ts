import { describe, expect, it } from 'vitest';

import { isMeetingCreateNluPatchSemanticallyEmpty, pickBundledMeetingCreateNudge } from './meeting-create-slots';
import { isLikelyMeetingCreateGreetingOnly } from './session';
import { peekMeetingCreateNluMissingSlots } from '@/src/lib/meeting-create-nlu/parse-edge-payload';
import type { Category } from '@/src/lib/categories';

const stubCategories: Category[] = [
  { id: 'c1', label: '스터디', emoji: '📚', order: 0, majorCode: 'Focus & Knowledge' },
];

describe('peekMeetingCreateNluMissingSlots place', () => {
  it('treats mood-only place string as satisfied', () => {
    const raw = {
      categoryId: 'c1',
      title: '테스트',
      minParticipants: 2,
      maxParticipants: 4,
      scheduleYmd: '2026-05-10',
      scheduleHm: '10:00',
      placeAutoPickQuery: '분위기 좋은 카페',
    };
    const m = peekMeetingCreateNluMissingSlots(stubCategories, raw, new Date('2026-05-03'));
    expect(m).not.toContain('place');
  });

  it('adds placeVenue when place is station-only', () => {
    const raw = {
      categoryId: 'c1',
      title: '테스트',
      minParticipants: 2,
      maxParticipants: 4,
      scheduleYmd: '2026-05-10',
      scheduleHm: '10:00',
      placeAutoPickQuery: '영등포역',
    };
    const m = peekMeetingCreateNluMissingSlots(stubCategories, raw, new Date('2026-05-03'));
    expect(m).toContain('placeVenue');
  });
});

describe('pickBundledMeetingCreateNudge', () => {
  it('returns opening when emptyTurn', () => {
    const t = pickBundledMeetingCreateNudge([], { emptyTurn: true, hadPartialAccum: false });
    expect(t).toContain('안녕하세요');
    expect(t).toContain('몇 분이');
  });

  it('when emptyTurn but slots remain missing, keeps slot-specific nudge (not opening repeat)', () => {
    const t = pickBundledMeetingCreateNudge(['category', 'place'], { emptyTurn: true, hadPartialAccum: true });
    expect(t).not.toContain('안녕하세요! 반가워요');
    expect(t).toContain('알려 주신 내용 반영');
    expect(t).toContain('어떤 모임');
  });

  it('bundles schedule headcount place', () => {
    const t = pickBundledMeetingCreateNudge(['schedule', 'headcount', 'place'], {
      emptyTurn: false,
      hadPartialAccum: false,
    });
    expect(t).toContain('몇 분이');
    expect(t).toContain('장소');
  });

  it('uses registry place copy for 영화 category', () => {
    const t = pickBundledMeetingCreateNudge(['schedule', 'headcount', 'place'], {
      emptyTurn: false,
      hadPartialAccum: false,
      resolvedCategory: { id: 'sRI7BKMxlPfE9MrtuS0G', label: '영화' },
    });
    expect(t).toContain('영화관');
  });

  it('nudges public meeting meta', () => {
    const t = pickBundledMeetingCreateNudge(['publicMeetingMeta'], {
      emptyTurn: false,
      hadPartialAccum: false,
    });
    expect(t).toContain('공개');
    expect(t).toContain('연령');
  });

  it('nudges placeVenue with area hint after schedule/headcount slots clear', () => {
    const t = pickBundledMeetingCreateNudge(['placeVenue'], {
      emptyTurn: false,
      hadPartialAccum: false,
      resolvedCategory: { id: 'c1', label: '스터디' },
      areaOnlyHint: '영등포역',
    });
    expect(t).toContain('영등포역');
    expect(t).toContain('어떤 장소를 찾아드릴까요');
  });
});

describe('isLikelyMeetingCreateGreetingOnly', () => {
  it('rejects short venue-like utterances', () => {
    expect(isLikelyMeetingCreateGreetingOnly('피시방')).toBe(false);
    expect(isLikelyMeetingCreateGreetingOnly('피시방이요')).toBe(false);
    expect(isLikelyMeetingCreateGreetingOnly('영화관')).toBe(false);
  });
  it('still accepts plain hello', () => {
    expect(isLikelyMeetingCreateGreetingOnly('안녕하세요')).toBe(true);
  });
});

describe('isMeetingCreateNluPatchSemanticallyEmpty', () => {
  it('returns true for empty object', () => {
    expect(isMeetingCreateNluPatchSemanticallyEmpty({})).toBe(true);
  });
  it('returns false when title present', () => {
    expect(isMeetingCreateNluPatchSemanticallyEmpty({ title: 'a' })).toBe(false);
  });
});
