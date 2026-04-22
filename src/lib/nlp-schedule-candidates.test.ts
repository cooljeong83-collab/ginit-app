import { describe, expect, it } from 'vitest';

import { computeNlpApply, dateCandidateDupKey, normalizeHm } from './nlp-schedule-candidates';
import type { DateCandidate } from './meeting-place-bridge';
import type { SmartNlpResult } from './natural-language-schedule';

describe('normalizeHm', () => {
  it('pads hours and keeps minutes', () => {
    expect(normalizeHm('7:05')).toBe('07:05');
    expect(normalizeHm('19:00')).toBe('19:00');
  });
});

describe('dateCandidateDupKey', () => {
  it('includes type/date/time/text fields', () => {
    const a: DateCandidate = { id: 'a', type: 'point', startDate: '2026-04-22', startTime: '7:05' };
    const b: DateCandidate = { id: 'b', type: 'point', startDate: '2026-04-22', startTime: '07:05' };
    expect(dateCandidateDupKey(a)).toBe(dateCandidateDupKey(b));
  });
});

describe('computeNlpApply', () => {
  it('always appends a new candidate', () => {
    const prev: DateCandidate[] = [{ id: 'd1', type: 'point', startDate: '2026-04-22', startTime: '15:00' }];
    const nlp: SmartNlpResult = {
      summary: '내일 저녁 7시',
      candidate: { type: 'point', startDate: '2026-04-23', startTime: '19:00' },
    };
    const out = computeNlpApply(prev, nlp);
    expect(out.didAppend).toBe(true);
    expect(out.next).toHaveLength(2);
    expect(out.next[1]?.startDate).toBe('2026-04-23');
  });
});

