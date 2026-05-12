import { describe, expect, it } from 'vitest';

import {
  formatDateTimeWithKoWeekday,
  formatYmdHmWithKoWeekday,
  formatYmdWithKoWeekday,
} from './date-display';

describe('date display helpers', () => {
  it('appends Korean weekday to YYYY-MM-DD', () => {
    expect(formatYmdWithKoWeekday('2026-05-12')).toBe('2026-05-12(화)');
  });

  it('keeps invalid date text unchanged', () => {
    expect(formatYmdWithKoWeekday('2026-02-31')).toBe('2026-02-31');
    expect(formatYmdWithKoWeekday('날짜 미정')).toBe('날짜 미정');
  });

  it('formats date and time labels consistently', () => {
    expect(formatYmdHmWithKoWeekday('2026-05-12', '15:00', ' · ')).toBe('2026-05-12(화) · 15:00');
    expect(formatDateTimeWithKoWeekday(new Date(2026, 4, 12, 9, 5))).toBe('2026-05-12(화) 09:05');
  });
});
