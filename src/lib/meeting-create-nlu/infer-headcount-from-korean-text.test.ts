import { describe, expect, it } from 'vitest';

import { inferMeetingCreateHeadcountFromKoreanText } from '@/src/lib/meeting-create-nlu/infer-headcount-from-korean-text';

describe('inferMeetingCreateHeadcountFromKoreanText numeric', () => {
  it('parses N명', () => {
    expect(inferMeetingCreateHeadcountFromKoreanText('7명')).toEqual({ minParticipants: 7, maxParticipants: 7 });
  });

  it('parses N~M명', () => {
    expect(inferMeetingCreateHeadcountFromKoreanText('10~20명')).toEqual({ minParticipants: 10, maxParticipants: 20 });
  });

  it('orders range low-high', () => {
    expect(inferMeetingCreateHeadcountFromKoreanText('8~3명')).toEqual({ minParticipants: 3, maxParticipants: 8 });
  });
});
