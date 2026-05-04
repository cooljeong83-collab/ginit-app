import { describe, expect, it } from 'vitest';

import { hydrateAppPoliciesFromRows, resetAppPoliciesCacheForTests } from '@/src/lib/app-policies-store';
import { isMeetingCreateNaturalLanguageBlocked } from '@/src/lib/meeting-create-nlu/nlu-blocked-text';

describe('isMeetingCreateNaturalLanguageBlocked', () => {
  it('uses DEFAULTS when cache empty', () => {
    resetAppPoliciesCacheForTests();
    expect(isMeetingCreateNaturalLanguageBlocked('마약 모임').blocked).toBe(true);
    expect(isMeetingCreateNaturalLanguageBlocked('스터디 모임').blocked).toBe(false);
  });

  it('respects hydrated policy rows', () => {
    resetAppPoliciesCacheForTests();
    hydrateAppPoliciesFromRows([
      {
        policy_group: 'meeting_create',
        policy_key: 'nlu_blocked',
        policy_value: { phrases: ['테스트금지'], userMessage: '차단됨' },
        is_active: true,
      },
    ]);
    const r = isMeetingCreateNaturalLanguageBlocked('테스트금지 포함');
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.message).toBe('차단됨');
  });
});
