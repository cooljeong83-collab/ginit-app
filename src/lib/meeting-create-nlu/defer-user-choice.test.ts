import { describe, expect, it } from 'vitest';

import {
  appendMovieNudgeBoxOfficeRanks,
  buildDeferChoiceMeetingCreatePatch,
  isDeferUserChoiceUtterance,
  pickDeterministicMenuPreferenceForDefer,
  tryPatchMovieTitleFromBoxOfficeRankReply,
} from '@/src/lib/meeting-create-nlu/defer-user-choice';

describe('isDeferUserChoiceUtterance', () => {
  it('true for common defer phrases', () => {
    expect(isDeferUserChoiceUtterance('아무거나')).toBe(true);
    expect(isDeferUserChoiceUtterance('랜덤으로 해줘')).toBe(true);
    expect(isDeferUserChoiceUtterance('너가 골라줘')).toBe(true);
    expect(isDeferUserChoiceUtterance('추천해줘')).toBe(true);
    expect(isDeferUserChoiceUtterance('상관없어')).toBe(true);
  });

  it('false for concrete choice', () => {
    expect(isDeferUserChoiceUtterance('한식으로 할게')).toBe(false);
    expect(isDeferUserChoiceUtterance('듄 볼래')).toBe(false);
  });
});

describe('pickDeterministicMenuPreferenceForDefer', () => {
  it('same seed → same label', () => {
    const a = pickDeterministicMenuPreferenceForDefer('cat:1:아무거나');
    const b = pickDeterministicMenuPreferenceForDefer('cat:1:아무거나');
    expect(a).toBe(b);
  });

  it('different seed may differ', () => {
    const a = pickDeterministicMenuPreferenceForDefer('a');
    const b = pickDeterministicMenuPreferenceForDefer('b');
    expect(typeof a).toBe('string');
    expect(typeof b).toBe('string');
  });
});

describe('buildDeferChoiceMeetingCreatePatch', () => {
  it('fills menu when defer and slot missing', () => {
    const p = buildDeferChoiceMeetingCreatePatch({
      raw: '아무거나',
      missingSlots: ['menuPreference'],
      categoryId: 'c1',
    });
    expect(p.menuPreferenceLabel).toBeTruthy();
  });

  it('empty when not defer', () => {
    expect(
      buildDeferChoiceMeetingCreatePatch({
        raw: '한식',
        missingSlots: ['menuPreference'],
        categoryId: 'c1',
      }),
    ).toEqual({});
  });
});

describe('appendMovieNudgeBoxOfficeRanks', () => {
  it('appends three rank lines when 3 movies', () => {
    const base = '함께 보실 영화 제목을 알려 주세요.';
    const out = appendMovieNudgeBoxOfficeRanks(base, [
      { title: 'A', kobisRank: '1' },
      { title: 'B', kobisRank: '2' },
      { title: 'C', kobisRank: '3' },
    ]);
    expect(out).toContain(base);
    expect(out).toContain('1위');
    expect(out).toContain('A');
    expect(out).toContain('2위');
    expect(out).toContain('아무거나');
  });

  it('unchanged when fewer than 3', () => {
    const base = 'x';
    expect(appendMovieNudgeBoxOfficeRanks(base, [{ title: 'A', kobisRank: '1' }])).toBe(base);
  });
});

describe('tryPatchMovieTitleFromBoxOfficeRankReply', () => {
  const top = [{ title: 'A' }, { title: 'B' }, { title: 'C' }] as const;

  it('maps bare digit to title when only moviePick is missing', () => {
    expect(tryPatchMovieTitleFromBoxOfficeRankReply('1', top, ['moviePick'])).toEqual({
      primaryMovieTitle: 'A',
      movieTitleHints: ['A'],
    });
    expect(tryPatchMovieTitleFromBoxOfficeRankReply('3', top, ['moviePick'])).toEqual({
      primaryMovieTitle: 'C',
      movieTitleHints: ['C'],
    });
  });

  it('does not map bare digit when headcount is also missing', () => {
    expect(tryPatchMovieTitleFromBoxOfficeRankReply('2', top, ['moviePick', 'headcount'])).toBe(null);
  });

  it('still maps explicit rank when headcount is missing', () => {
    expect(tryPatchMovieTitleFromBoxOfficeRankReply('2위', top, ['moviePick', 'headcount'])).toEqual({
      primaryMovieTitle: 'B',
      movieTitleHints: ['B'],
    });
  });

  it('null without pending top three', () => {
    expect(tryPatchMovieTitleFromBoxOfficeRankReply('1', null, ['moviePick'])).toBe(null);
  });
});
