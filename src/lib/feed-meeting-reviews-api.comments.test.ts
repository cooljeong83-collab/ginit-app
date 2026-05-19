import { describe, expect, it } from 'vitest';

import { parseFeedReviewCommentsField } from './feed-meeting-review-comments-parse';

describe('parseFeedReviewCommentsField', () => {
  it('preserves server order for multiple strings', () => {
    expect(parseFeedReviewCommentsField(['와 정말 맛있어요', '둘이 먹다가 하나가 죽어도 모를 맛이에요'], '')).toEqual([
      '와 정말 맛있어요',
      '둘이 먹다가 하나가 죽어도 모를 맛이에요',
    ]);
  });

  it('falls back to single comment when comments array empty', () => {
    expect(parseFeedReviewCommentsField([], '대표 코멘트')).toEqual(['대표 코멘트']);
  });

  it('parses JSON string array', () => {
    expect(
      parseFeedReviewCommentsField('["첫 번째","두 번째"]', ''),
    ).toEqual(['첫 번째', '두 번째']);
  });

  it('does not append fallback when comments array is non-empty', () => {
    expect(parseFeedReviewCommentsField(['A', 'B'], 'A')).toEqual(['A', 'B']);
  });
});
