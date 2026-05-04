import { describe, expect, it } from 'vitest';

import { buildMeetingCreateNluConfirmSummary } from './confirm-summary';
import type { Category } from '@/src/lib/categories';
import type { MeetingCreateNluPlan } from '@/src/lib/meeting-create-nlu/types';

const cats: Category[] = [{ id: 'c1', label: '스터디', emoji: '📚', order: 0, majorCode: 'Focus & Knowledge' }];

const plan: MeetingCreateNluPlan = {
  categoryId: 'c1',
  categoryLabel: '스터디',
  suggestedIsPublic: true,
  title: '독서',
  minParticipants: 3,
  maxParticipants: 5,
  autoSchedule: { ymd: '2026-05-10', hm: '14:00' },
  placeAutoPickQuery: '키즈카페',
  menuPreferenceLabel: null,
  movieTitleHints: [],
  activityKindLabel: null,
  gameKindLabel: null,
  pcGameKindLabel: null,
  focusKnowledgeLabel: '독서·스터디',
  canAutoCompleteThroughStep3: true,
  publicMeetingDetailsPartial: null,
  unknownFields: [],
};

describe('buildMeetingCreateNluConfirmSummary', () => {
  it('includes fixed preamble and closer', () => {
    const s = buildMeetingCreateNluConfirmSummary(plan, cats);
    expect(s).toContain('이런 모임을 원하시는군요');
    expect(s).toContain('모임 생성을 도와드릴까요');
    expect(s).toContain('독서');
    expect(s).toContain('키즈카페');
  });

  it('uses nluConfirmMessage when present', () => {
    const s = buildMeetingCreateNluConfirmSummary(
      { ...plan, nluConfirmMessage: '모델이 쓴 요약 한 줄입니다.' },
      cats,
    );
    expect(s).toBe('모델이 쓴 요약 한 줄입니다.');
  });
});
