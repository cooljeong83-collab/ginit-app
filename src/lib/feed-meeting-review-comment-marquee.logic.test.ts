import { describe, expect, it } from 'vitest';

import {
  buildFeedReviewMarqueeTickerText,
  feedReviewCommentRotationHoldMs,
  formatFeedReviewCommentDisplay,
  shouldRotateCommentsWithFade,
} from '@/src/lib/feed-meeting-review-comment-marquee.logic';

describe('shouldRotateCommentsWithFade', () => {
  it('rotates when two or more comments', () => {
    expect(shouldRotateCommentsWithFade(2)).toBe(true);
    expect(shouldRotateCommentsWithFade(1)).toBe(false);
  });
});

describe('formatFeedReviewCommentDisplay', () => {
  it('returns trimmed comment without quotes', () => {
    expect(formatFeedReviewCommentDisplay('  맛있어요  ')).toBe('맛있어요');
  });
});

describe('buildFeedReviewMarqueeTickerText', () => {
  it('joins comments with separator', () => {
    const t = buildFeedReviewMarqueeTickerText(['a', 'b']);
    expect(t).toBe('a   ·   b');
  });
});

describe('feedReviewCommentRotationHoldMs', () => {
  it('scales with text length within bounds', () => {
    const short = feedReviewCommentRotationHoldMs('a');
    const long = feedReviewCommentRotationHoldMs('가'.repeat(80));
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(9_500);
  });
});
