import { describe, expect, it } from 'vitest';

import {
  isFeedMeetingReviewsRpcEmptyPayload,
  isFeedMeetingReviewsRpcPayloadUnexpected,
  parseFeedMeetingReviewsRpcJsonbRows,
} from './feed-meeting-reviews-rpc-parse';

describe('parseFeedMeetingReviewsRpcJsonbRows', () => {
  it('accepts empty array from RPC', () => {
    expect(parseFeedMeetingReviewsRpcJsonbRows([])).toEqual([]);
  });

  it('accepts null and JSON empty array string', () => {
    expect(parseFeedMeetingReviewsRpcJsonbRows(null)).toEqual([]);
    expect(parseFeedMeetingReviewsRpcJsonbRows('[]')).toEqual([]);
  });
});

describe('isFeedMeetingReviewsRpcPayloadUnexpected', () => {
  it('does not flag empty region (no reviews)', () => {
    expect(isFeedMeetingReviewsRpcPayloadUnexpected([], 0)).toBe(false);
    expect(isFeedMeetingReviewsRpcPayloadUnexpected(null, 0)).toBe(false);
    expect(isFeedMeetingReviewsRpcPayloadUnexpected('[]', 0)).toBe(false);
  });

  it('flags non-array object payloads', () => {
    expect(isFeedMeetingReviewsRpcEmptyPayload({ foo: 1 })).toBe(false);
    expect(isFeedMeetingReviewsRpcPayloadUnexpected({ foo: 1 }, 0)).toBe(true);
  });
});
