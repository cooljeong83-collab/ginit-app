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

  it('parses N대N 성비 모집 as total headcount', () => {
    expect(inferMeetingCreateHeadcountFromKoreanText('내일 영등포역 3대3 벙개')).toEqual({
      minParticipants: 6,
      maxParticipants: 6,
    });
    expect(inferMeetingCreateHeadcountFromKoreanText('4 대 4')).toEqual({ minParticipants: 8, maxParticipants: 8 });
    expect(inferMeetingCreateHeadcountFromKoreanText('2:2')).toEqual({ minParticipants: 4, maxParticipants: 4 });
  });
});
