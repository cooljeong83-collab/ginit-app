import { describe, expect, it } from 'vitest';

import { isMeetingCreateNluSummaryRejectionText } from '@/src/lib/meeting-create-agent-chat/nlu-confirm-intent';

describe('isMeetingCreateNluSummaryRejectionText', () => {
  it('matches short negations', () => {
    expect(isMeetingCreateNluSummaryRejectionText('아니요')).toBe(true);
    expect(isMeetingCreateNluSummaryRejectionText('no')).toBe(true);
    expect(isMeetingCreateNluSummaryRejectionText('틀렸어')).toBe(true);
  });

  it('returns false for long unrelated text', () => {
    expect(isMeetingCreateNluSummaryRejectionText('내일 오후 3시로 바꿔 주세요')).toBe(false);
  });
});
