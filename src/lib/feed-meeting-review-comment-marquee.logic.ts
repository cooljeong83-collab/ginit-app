export const FEED_REVIEW_COMMENT_FADE_MS = 320;

export const FEED_REVIEW_COMMENT_ROTATION_HOLD_MIN_MS = 3_200;

export const FEED_REVIEW_COMMENT_ROTATION_HOLD_MAX_MS = 9_500;

export const FEED_REVIEW_MARQUEE_TICKER_SEP = '   ·   ';

/** 코멘트 2건 이상이면 페이드 로테이션(한 줄씩, 넘치면 말줄임) */
export function shouldRotateCommentsWithFade(commentCount: number): boolean {
  return commentCount > 1;
}

export function formatFeedReviewCommentDisplay(comment: string): string {
  return comment.trim();
}

export function buildFeedReviewMarqueeTickerText(comments: readonly string[]): string {
  return comments
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => formatFeedReviewCommentDisplay(c))
    .join(FEED_REVIEW_MARQUEE_TICKER_SEP);
}

/** 코멘트 길이에 비례한 노출 시간(페이드 전환 전) */
export function feedReviewCommentRotationHoldMs(displayText: string): number {
  const len = displayText.trim().length;
  const ms = FEED_REVIEW_COMMENT_ROTATION_HOLD_MIN_MS + len * 42;
  return Math.min(FEED_REVIEW_COMMENT_ROTATION_HOLD_MAX_MS, Math.max(FEED_REVIEW_COMMENT_ROTATION_HOLD_MIN_MS, ms));
}
