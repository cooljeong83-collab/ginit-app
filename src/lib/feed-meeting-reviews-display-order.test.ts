import { describe, expect, it } from 'vitest';

import { shuffleFeedMeetingReviewsForDisplay } from './feed-meeting-reviews-display-order';

describe('shuffleFeedMeetingReviewsForDisplay', () => {
  it('returns a permutation with the same elements', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffleFeedMeetingReviewsForDisplay(input, 42);
    expect(out.sort()).toEqual(input.sort());
  });

  it('is deterministic for the same seed', () => {
    const input = ['a', 'b', 'c', 'd'];
    const a = shuffleFeedMeetingReviewsForDisplay(input, 99);
    const b = shuffleFeedMeetingReviewsForDisplay(input, 99);
    expect(a).toEqual(b);
  });

  it('does not mutate the source array', () => {
    const input = [1, 2, 3];
    const copy = [...input];
    shuffleFeedMeetingReviewsForDisplay(input, 1);
    expect(input).toEqual(copy);
  });
});
