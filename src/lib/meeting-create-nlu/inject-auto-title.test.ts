import { describe, expect, it } from 'vitest';

import { mergeMeetingCreateNluAccumulatedWithAutoTitle } from './inject-auto-title';
import type { MeetingTitleSuggestionContext } from '@/src/lib/meeting-title-suggestion';

const ctx: MeetingTitleSuggestionContext = {};

describe('mergeMeetingCreateNluAccumulatedWithAutoTitle', () => {
  it('fills title from openingUtteranceTitleFallback before AI suggestion', () => {
    const now = new Date('2026-05-03');
    const acc = { categoryId: 'x', scheduleYmd: '2026-05-05', scheduleHm: '21:00' };
    const out = mergeMeetingCreateNluAccumulatedWithAutoTitle({
      accumulated: acc,
      now,
      manualTitle: '',
      openingUtteranceTitleFallback: '영등포역 2:2 미팅',
      aiTitleSuggestionFirst: 'AI 제안',
      categoryLabelForTitle: '스터디',
      titleSuggestionCtx: ctx,
    });
    expect((out as { title?: string }).title).toBe('영등포역 2:2 미팅');
  });

  it('does not override existing accumulated title', () => {
    const now = new Date('2026-05-03');
    const acc = { title: '이미 있음' };
    const out = mergeMeetingCreateNluAccumulatedWithAutoTitle({
      accumulated: acc,
      now,
      manualTitle: '',
      openingUtteranceTitleFallback: '다른 것',
      aiTitleSuggestionFirst: '',
      categoryLabelForTitle: '모임',
      titleSuggestionCtx: ctx,
    });
    expect((out as { title?: string }).title).toBe('이미 있음');
  });
});
