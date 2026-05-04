import { describe, expect, it } from 'vitest';

import type { Category } from '@/src/lib/categories';
import { inferMeetingCreateCategoryFromUtterance } from '@/src/lib/meeting-create-nlu/category-from-utterance';

const foodA: Category = {
  id: 'food-a',
  label: '맛집·카페 탐방',
  emoji: '🍽',
  order: 2,
  majorCode: 'Eat & Drink',
};
const foodB: Category = {
  id: 'food-b',
  label: '야식·술 회식',
  emoji: '🍺',
  order: 1,
  majorCode: 'Eat & Drink',
};
const movieCat: Category = {
  id: 'cat-movie',
  label: '영화 관람',
  emoji: '🎬',
  order: 10,
  majorCode: 'MOVIE',
};
const studyCat: Category = {
  id: 'cat-study',
  label: '스터디·카공',
  emoji: '📚',
  order: 5,
  majorCode: 'Focus & Knowledge',
};

describe('inferMeetingCreateCategoryFromUtterance', () => {
  it('영화 발화 → majorCode MOVIE 행', () => {
    const cats = [foodA, movieCat, studyCat];
    const got = inferMeetingCreateCategoryFromUtterance('내일 친구와 영화를 볼거야', cats);
    expect(got?.id).toBe('cat-movie');
  });

  it('커피 마실거야 → food specialty 행(동점 시 order 우선)', () => {
    const cats = [movieCat, foodA, foodB];
    const got = inferMeetingCreateCategoryFromUtterance('내일 친구랑 커피 마실거야', cats);
    expect(got && (got.id === 'food-a' || got.id === 'food-b')).toBe(true);
    expect(got?.majorCode).toBe('Eat & Drink');
    expect(got?.id).toBe('food-b');
  });

  it('영화 전용 힌트(넷플)는 movie 행이 food보다 우선', () => {
    const cats = [foodA, movieCat];
    const got = inferMeetingCreateCategoryFromUtterance('오늘 넷플로 볼래', cats);
    expect(got?.id).toBe('cat-movie');
  });

  it('스터디 힌트 → knowledge 행', () => {
    const cats = [foodA, studyCat];
    const got = inferMeetingCreateCategoryFromUtterance('주말에 스터디 하자', cats);
    expect(got?.id).toBe('cat-study');
  });

  it('일치 없으면 null', () => {
    const cats = [foodA, movieCat];
    expect(inferMeetingCreateCategoryFromUtterance('그냥 만나요', cats)).toBeNull();
  });

  it('registry 키워드로 시드 운동 id 매칭', () => {
    const run: Category = {
      id: 'uUnuq6A7Aal9fw3lLOQ3',
      label: '운동',
      emoji: '🏃',
      order: 3,
      majorCode: 'Active & Life',
    };
    const cats = [foodA, movieCat, run];
    const got = inferMeetingCreateCategoryFromUtterance('내일 친구랑 러닝 할거야', cats);
    expect(got?.id).toBe('uUnuq6A7Aal9fw3lLOQ3');
  });
});
