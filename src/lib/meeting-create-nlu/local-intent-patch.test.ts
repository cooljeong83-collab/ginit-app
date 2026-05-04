import { describe, expect, it } from 'vitest';

import {
  buildLocalMeetingCreateNluPatch,
  LOCAL_MEETING_CREATE_NLU_MAX_CHARS,
  LOCAL_MEETING_CREATE_NLU_MIN_CHARS_FOR_GEMINI,
  normalizeLocalMeetingCreateTextForLength,
  shouldSkipGeminiForMeetingCreate,
} from '@/src/lib/meeting-create-nlu/local-intent-patch';
import { MEETING_CREATE_COFFEE_CATEGORY_ID, MEETING_CREATE_MEAL_CATEGORY_ID } from '@/src/lib/meeting-create-nlu/meeting-create-category-registry';
import type { Category } from '@/src/lib/categories';

const foodCat: Category = {
  id: 'cat-food',
  label: '맛집·카페 탐방',
  emoji: '🍽',
  order: 1,
  majorCode: 'Eat & Drink',
};
const movieCat: Category = {
  id: 'cat-movie',
  label: '영화 관람',
  emoji: '🎬',
  order: 2,
  majorCode: 'MOVIE',
};
const cats: Category[] = [movieCat, foodCat];

const activeLifeCat: Category = {
  id: 'cat-active',
  label: '운동·액티브',
  emoji: '🏃',
  order: 3,
  majorCode: 'Active & Life',
};

describe('buildLocalMeetingCreateNluPatch', () => {
  const now = new Date('2026-05-03T12:00:00');

  it('parses 내일 9시 영등포역 schedule + place', () => {
    const p = buildLocalMeetingCreateNluPatch({ text: '내일 9시 영등포역', categories: cats, now });
    expect(p.scheduleYmd).toBe('2026-05-04');
    expect(p.scheduleHm).toBe('21:00');
    expect(p.placeAutoPickQuery).toBe('영등포역');
  });

  it('sets place for 분위기 좋은 카페', () => {
    const p = buildLocalMeetingCreateNluPatch({ text: '분위기 좋은 카페', categories: cats, now });
    expect(p.placeAutoPickQuery).toContain('분위기');
  });

  it('sets menu + food category for 한식', () => {
    const p = buildLocalMeetingCreateNluPatch({ text: '한식', categories: cats, now });
    expect(p.menuPreferenceLabel).toBe('한식');
    expect(p.categoryId).toBe('cat-food');
  });

  it('infers movie categoryId from 영화 발화 without menu token', () => {
    const p = buildLocalMeetingCreateNluPatch({ text: '내일 친구와 영화를 볼거야', categories: cats, now });
    expect(p.categoryId).toBe('cat-movie');
    expect(p.categoryLabel).toBe('영화 관람');
  });

  it('keeps keyword-picked food category when menu token matches (단일 토큰)', () => {
    const p = buildLocalMeetingCreateNluPatch({ text: '카페', categories: cats, now });
    expect(p.menuPreferenceLabel).toBe('카페');
    expect(p.categoryId).toBe('cat-food');
  });

  it('prefers 커피 category id when 발화에 커피 의도', () => {
    const meal: Category = {
      id: MEETING_CREATE_MEAL_CATEGORY_ID,
      label: '식사',
      emoji: '🍽️',
      order: 1,
      majorCode: 'Eat & Drink',
    };
    const coffee: Category = {
      id: MEETING_CREATE_COFFEE_CATEGORY_ID,
      label: '커피',
      emoji: '☕',
      order: 6,
      majorCode: 'Eat & Drink',
    };
    const p = buildLocalMeetingCreateNluPatch({
      text: '내일 친구랑 커피 마실거야',
      categories: [movieCat, meal, coffee],
      now,
    });
    expect(p.categoryId).toBe(MEETING_CREATE_COFFEE_CATEGORY_ID);
    expect(p.menuPreferenceLabel).toBe('카페');
  });

  it('sets headcount for 4명', () => {
    const p = buildLocalMeetingCreateNluPatch({ text: '4명', categories: cats, now });
    expect(p.minParticipants).toBe(4);
    expect(p.maxParticipants).toBe(4);
  });

  it('sets headcount range for 10~20명', () => {
    const p = buildLocalMeetingCreateNluPatch({ text: '10~20명', categories: cats, now });
    expect(p.minParticipants).toBe(10);
    expect(p.maxParticipants).toBe(20);
  });

  it('sets activityKindLabel for Active & Life when utterance mentions 러닝', () => {
    const p = buildLocalMeetingCreateNluPatch({
      text: '내일 영등포 공원에서 러닝 모임',
      categories: [movieCat, foodCat, activeLifeCat],
      now,
    });
    expect(p.categoryId).toBe('cat-active');
    expect(p.activityKindLabel).toBe('러닝·조깅');
  });
});

describe('shouldSkipGeminiForMeetingCreate', () => {
  it('is false when text exceeds max length even with patch', () => {
    const pad = 'x'.repeat(LOCAL_MEETING_CREATE_NLU_MAX_CHARS + 1);
    expect(shouldSkipGeminiForMeetingCreate(`${pad}한식`, { menuPreferenceLabel: '한식' })).toBe(false);
  });

  it('is false for empty patch', () => {
    expect(shouldSkipGeminiForMeetingCreate('안녕', {})).toBe(false);
  });

  it('is true for short text with non-empty patch', () => {
    expect(shouldSkipGeminiForMeetingCreate('한식', { menuPreferenceLabel: '한식' })).toBe(true);
  });

  it('is false when normalized length reaches min for Gemini even with local patch', () => {
    const pad = 'x'.repeat(Math.max(0, LOCAL_MEETING_CREATE_NLU_MIN_CHARS_FOR_GEMINI - 2));
    expect(shouldSkipGeminiForMeetingCreate(`${pad}한식`, { menuPreferenceLabel: '한식' })).toBe(false);
  });
});

describe('normalizeLocalMeetingCreateTextForLength', () => {
  it('collapses spaces and NFKC', () => {
    expect(normalizeLocalMeetingCreateTextForLength('  a　b  ')).toBe('a b');
  });
});
