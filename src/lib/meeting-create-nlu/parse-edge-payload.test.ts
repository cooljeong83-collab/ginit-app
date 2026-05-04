import { describe, expect, it } from 'vitest';

import type { Category } from '@/src/lib/categories';
import type { MeetingCreateNluEdgePayload } from '@/src/lib/meeting-create-nlu/types';
import {
  parseMeetingCreateNluPayload,
  peekMeetingCreateNluMissingSlots,
  resolveMeetingCreateCategoryId,
} from '@/src/lib/meeting-create-nlu/parse-edge-payload';

const cats: Category[] = [
  { id: 'cat-food', label: '식사', emoji: '🍽', order: 1, majorCode: 'food' },
];

const catsStudy: Category[] = [
  { id: 'cat-st', label: '스터디', emoji: '📚', order: 0, majorCode: 'Focus & Knowledge' },
];

const catsActiveLife: Category[] = [
  { id: 'cat-run', label: '운동·액티브', emoji: '🏃', order: 0, majorCode: 'Active & Life' },
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
        menuPreferenceLabel: '한식',
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

  it('accepts headcount from Korean 인원 object only', () => {
    const now = new Date('2026-05-03T12:00:00');
    const r = parseMeetingCreateNluPayload(
      catsStudy,
      {
        categoryId: 'cat-st',
        title: '주말 모각코',
        인원: { 최소: 2, 최대: 2 },
        scheduleYmd: '2026-05-04',
        scheduleHm: '14:00',
        placeAutoPickQuery: '강남역 카페',
        focusKnowledgeLabel: '독서·스터디',
      },
      now,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.minParticipants).toBe(2);
    expect(r.plan.maxParticipants).toBe(2);
  });

  it('passes through nluConfirmMessage and nluInference', () => {
    const now = new Date('2026-05-03T12:00:00');
    const r = parseMeetingCreateNluPayload(
      catsStudy,
      {
        categoryId: 'cat-st',
        title: '주말 모각코',
        minParticipants: 2,
        maxParticipants: 2,
        scheduleYmd: '2026-05-04',
        scheduleHm: '14:00',
        placeAutoPickQuery: '강남역 카페',
        focusKnowledgeLabel: '독서·스터디',
        nluConfirmMessage: '요약은 모델이 직접 썼습니다.',
        nluInference: { intent_strength: 'High', social_context: '스터디', reasoning: '카공 언급' },
      },
      now,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.nluConfirmMessage).toBe('요약은 모델이 직접 썼습니다.');
    expect(r.plan.nluInference?.intent_strength).toBe('High');
  });
});

describe('resolveMeetingCreateCategoryId', () => {
  it('resolves by majorCodeHint when categoryId is missing', () => {
    const id = resolveMeetingCreateCategoryId(
      catsStudy,
      { majorCodeHint: 'Focus & Knowledge' } as MeetingCreateNluEdgePayload,
    );
    expect(id).toBe('cat-st');
  });
});

describe('peekMeetingCreateNluMissingSlots Active & Life activity from title', () => {
  it('does not require activityKind when title mentions 러닝', () => {
    const raw = {
      categoryId: 'cat-run',
      title: '내일 영등포 공원 러닝 모임',
      minParticipants: 2,
      maxParticipants: 4,
      scheduleYmd: '2026-05-04',
      scheduleHm: '07:00',
      placeAutoPickQuery: '영등포 공원',
    };
    const m = peekMeetingCreateNluMissingSlots(catsActiveLife, raw, new Date('2026-05-03'));
    expect(m).not.toContain('activityKind');
  });
});

describe('parseMeetingCreateNluPayload Active & Life activity inferred', () => {
  it('fills activityKindLabel from title when field omitted', () => {
    const now = new Date('2026-05-03T12:00:00');
    const r = parseMeetingCreateNluPayload(
      catsActiveLife,
      {
        categoryId: 'cat-run',
        title: '내일 영등포 공원 러닝 모임',
        minParticipants: 2,
        maxParticipants: 4,
        scheduleYmd: '2026-05-04',
        scheduleHm: '07:00',
        placeAutoPickQuery: '영등포 공원',
      },
      now,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.activityKindLabel).toBe('러닝·조깅');
  });
});

describe('peekMeetingCreateNluMissingSlots title slot', () => {
  it('does not require title in missing slots when title absent', () => {
    const raw = {
      categoryId: 'cat-st',
      minParticipants: 2,
      maxParticipants: 2,
      scheduleYmd: '2026-05-10',
      scheduleHm: '10:00',
      placeAutoPickQuery: '분위기 좋은 카페',
      focusKnowledgeLabel: '독서·스터디',
    };
    const m = peekMeetingCreateNluMissingSlots(catsStudy, raw, new Date('2026-05-03'));
    expect(m).not.toContain('title');
  });
});

describe('peekMeetingCreateNluMissingSlots headcount + public meta', () => {
  it('does not mark headcount missing when only 인원 object is set', () => {
    const raw = {
      categoryId: 'cat-st',
      title: 't',
      인원: { 최소: 2, 최대: 2 },
      scheduleYmd: '2026-05-10',
      scheduleHm: '10:00',
      placeAutoPickQuery: '분위기 좋은 카페',
      focusKnowledgeLabel: '독서·스터디',
    };
    const m = peekMeetingCreateNluMissingSlots(catsStudy, raw, new Date('2026-05-03'));
    expect(m).not.toContain('headcount');
  });

  it('marks publicMeetingMeta when public without ageLimit', () => {
    const raw = {
      categoryId: 'cat-st',
      title: 't',
      minParticipants: 4,
      maxParticipants: 6,
      scheduleYmd: '2026-05-10',
      scheduleHm: '10:00',
      placeAutoPickQuery: '홍대',
      suggestedIsPublic: true,
      publicMeetingDetails: {},
      focusKnowledgeLabel: '독서·스터디',
    };
    const m = peekMeetingCreateNluMissingSlots(catsStudy, raw, new Date('2026-05-03'));
    expect(m).toContain('publicMeetingMeta');
  });

  it('clears publicMeetingMeta when ageLimit present', () => {
    const raw = {
      categoryId: 'cat-st',
      title: 't',
      minParticipants: 4,
      maxParticipants: 6,
      scheduleYmd: '2026-05-10',
      scheduleHm: '10:00',
      placeAutoPickQuery: '홍대',
      suggestedIsPublic: true,
      publicMeetingDetails: { ageLimit: ['TWENTIES'] },
      focusKnowledgeLabel: '독서·스터디',
    };
    const m = peekMeetingCreateNluMissingSlots(catsStudy, raw, new Date('2026-05-03'));
    expect(m).not.toContain('publicMeetingMeta');
  });
});

describe('peekMeetingCreateNluMissingSlots movie', () => {
  const movieCats: Category[] = [
    { id: 'sRI7BKMxlPfE9MrtuS0G', label: '영화', emoji: '🎬', order: 2, majorCode: 'MOVIE' },
  ];

  it('marks moviePick when 영화 category and no title hints', () => {
    const raw = {
      categoryId: 'sRI7BKMxlPfE9MrtuS0G',
      title: '주말 영화',
      minParticipants: 2,
      maxParticipants: 2,
      scheduleYmd: '2026-05-10',
      scheduleHm: '19:00',
      placeAutoPickQuery: '강남 CGV',
    };
    const m = peekMeetingCreateNluMissingSlots(movieCats, raw, new Date('2026-05-03'));
    expect(m).toContain('moviePick');
  });

  it('clears moviePick when primaryMovieTitle set', () => {
    const raw = {
      categoryId: 'sRI7BKMxlPfE9MrtuS0G',
      title: '주말 영화',
      minParticipants: 2,
      maxParticipants: 2,
      scheduleYmd: '2026-05-10',
      scheduleHm: '19:00',
      placeAutoPickQuery: '강남 CGV',
      primaryMovieTitle: '듄: 파트 2',
    };
    const m = peekMeetingCreateNluMissingSlots(movieCats, raw, new Date('2026-05-03'));
    expect(m).not.toContain('moviePick');
  });
});
