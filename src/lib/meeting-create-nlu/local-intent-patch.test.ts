import { describe, expect, it } from 'vitest';

import {
  buildLocalMeetingCreateNluPatch,
  combineMeetingCreatePlaceQuery,
  fillMeetingCreateNluPatchFromLocalEdge,
  isAreaOnlyPlaceQuery,
  mergeMeetingCreatePlacePatchWithAccumulated,
  normalizeLocalMeetingCreateTextForLength,
  shouldSkipEdgeNluForMeetingCreate,
} from '@/src/lib/meeting-create-nlu/local-intent-patch';
import {
  appendMeetingCreateAgentChatMessage,
  createEmptyMeetingCreateAgentChatSession,
  meetingCreateAgentChatSlidingHistoryForEdge,
  mergeMeetingCreateNluAccumulated,
} from '@/src/lib/meeting-create-agent-chat/session';
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

  it('merges accumulated area-only + venue-only reply into one place query', () => {
    const p = buildLocalMeetingCreateNluPatch({
      text: '삼겹살집',
      categories: cats,
      now,
      accumulated: { placeAutoPickQuery: '영등포역' },
    });
    expect(p.placeAutoPickQuery).toBe('영등포역 삼겹살집');
  });

  it('single utterance station + venue returns combined place', () => {
    const p = buildLocalMeetingCreateNluPatch({
      text: '영등포역 삼겹살집',
      categories: cats,
      now,
    });
    expect(p.placeAutoPickQuery).toBe('영등포역 삼겹살집');
  });

  it('parses 내일 영등포역3대3 벙개 (역+숫자 붙임, 성비 인원, 카테고리)', () => {
    const bungaeCat: Category = {
      id: 'xYAgS71J2K5t9x4PfTkJ',
      label: '벙개·미팅',
      emoji: '',
      order: 0,
      majorCode: 'Eat & Drink',
    };
    const p = buildLocalMeetingCreateNluPatch({
      text: '내일 영등포역3대3 벙개 모임',
      categories: [movieCat, bungaeCat, foodCat],
      now: new Date('2026-05-03T12:00:00'),
    });
    expect(p.placeAutoPickQuery).toBe('영등포역');
    expect(p.scheduleYmd).toBe('2026-05-04');
    expect(p.minParticipants).toBe(6);
    expect(p.maxParticipants).toBe(6);
    expect(p.categoryId).toBe('xYAgS71J2K5t9x4PfTkJ');
    expect(p.menuPreferenceLabel).toBe('주점·호프');
  });
});

describe('place query combine + area-only', () => {
  it('isAreaOnlyPlaceQuery is true for station only', () => {
    expect(isAreaOnlyPlaceQuery('영등포역')).toBe(true);
    expect(isAreaOnlyPlaceQuery('영등포역 삼겹살집')).toBe(false);
  });

  it('combineMeetingCreatePlaceQuery joins area + venue', () => {
    expect(combineMeetingCreatePlaceQuery('영등포역', '삼겹살집')).toBe('영등포역 삼겹살집');
  });

  it('mergeMeetingCreatePlacePatchWithAccumulated upgrades venue-only edge patch', () => {
    const out = mergeMeetingCreatePlacePatchWithAccumulated(
      { placeAutoPickQuery: '영등포역' },
      { placeAutoPickQuery: '삼겹살집' },
    );
    expect(out.placeAutoPickQuery).toBe('영등포역 삼겹살집');
  });

  it('mergeMeetingCreateNluAccumulated merges place without dropping area', () => {
    const m = mergeMeetingCreateNluAccumulated(
      { placeAutoPickQuery: '영등포역', 장소: '영등포역' },
      { placeAutoPickQuery: '삼겹살집' },
    );
    expect(m.placeAutoPickQuery).toBe('영등포역 삼겹살집');
    expect(m['장소']).toBe('영등포역 삼겹살집');
  });
});

describe('meetingCreateAgentChatSlidingHistoryForEdge', () => {
  it('excludes latest user line and keeps at most maxTurns pairs', () => {
    let s = createEmptyMeetingCreateAgentChatSession();
    s = appendMeetingCreateAgentChatMessage(s, 'user', 'u1');
    s = appendMeetingCreateAgentChatMessage(s, 'assistant', 'a1');
    s = appendMeetingCreateAgentChatMessage(s, 'user', 'u2');
    s = appendMeetingCreateAgentChatMessage(s, 'assistant', 'a2');
    s = appendMeetingCreateAgentChatMessage(s, 'user', 'u3-current');
    const h = meetingCreateAgentChatSlidingHistoryForEdge(s, 3);
    expect(h).toContain('u1');
    expect(h).toContain('u2');
    expect(h).not.toContain('u3-current');
  });
});

describe('mergeMeetingCreateNluAccumulated keep prior without new info', () => {
  it('does not overwrite non-empty title with empty string from patch', () => {
    const m = mergeMeetingCreateNluAccumulated({ title: '점심 번개' }, { title: '', scheduleYmd: '2026-05-10' });
    expect(m.title).toBe('점심 번개');
    expect(m.scheduleYmd).toBe('2026-05-10');
  });

  it('does not overwrite non-empty array with empty array from patch', () => {
    const m = mergeMeetingCreateNluAccumulated({ movieTitleHints: ['인셉션'] }, { movieTitleHints: [] });
    expect(m.movieTitleHints).toEqual(['인셉션']);
  });

  it('merges 인원 without null patch fields wiping prior subkeys', () => {
    const m = mergeMeetingCreateNluAccumulated(
      { 인원: { 최소: 2, 최대: 2 } },
      { 인원: { 최소: null, 최대: 4 } as Record<string, unknown> },
    );
    expect(m['인원']).toEqual({ 최소: 2, 최대: 4 });
  });
});

describe('fillMeetingCreateNluPatchFromLocalEdge', () => {
  it('fills empty Edge fields from local patch', () => {
    const merged = fillMeetingCreateNluPatchFromLocalEdge(
      { title: '번개', categoryId: null },
      { categoryId: 'x1', scheduleYmd: '2026-05-04', minParticipants: 6, maxParticipants: 6 },
    );
    expect(merged.title).toBe('번개');
    expect(merged.categoryId).toBe('x1');
    expect(merged.scheduleYmd).toBe('2026-05-04');
    expect(merged.minParticipants).toBe(6);
  });
});

describe('shouldSkipEdgeNluForMeetingCreate', () => {
  it('is always false so Edge(Groq Llama) is invoked regardless of length or local patch', () => {
    expect(shouldSkipEdgeNluForMeetingCreate('한식', { menuPreferenceLabel: '한식' })).toBe(false);
    expect(shouldSkipEdgeNluForMeetingCreate('안녕', {})).toBe(false);
    expect(shouldSkipEdgeNluForMeetingCreate('123', {})).toBe(false);
    const pad = 'x'.repeat(100);
    expect(shouldSkipEdgeNluForMeetingCreate(`${pad}한식`, { menuPreferenceLabel: '한식' })).toBe(false);
  });
});

describe('normalizeLocalMeetingCreateTextForLength', () => {
  it('collapses spaces and NFKC', () => {
    expect(normalizeLocalMeetingCreateTextForLength('  a　b  ')).toBe('a b');
  });
});
