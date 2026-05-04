import { describe, expect, it } from 'vitest';

import {
  coerceWizardActivityKindLabel,
  coerceWizardFocusKnowledgeLabel,
  coerceWizardMenuPreferenceLabel,
  matchesWizardOptionPhrase,
} from '@/src/lib/meeting-create-nlu/wizard-specialty-chip-options';

describe('matchesWizardOptionPhrase · delimiter', () => {
  it('maps either segment to the full compound activity label', () => {
    expect(matchesWizardOptionPhrase('조깅', '러닝·조깅')).toBe(true);
    expect(matchesWizardOptionPhrase('러닝', '러닝·조깅')).toBe(true);
    expect(matchesWizardOptionPhrase('내일 공원 조깅', '러닝·조깅')).toBe(true);
  });

  it('does not substring-match compound labels outside · segments (재테크 vs 테크)', () => {
    expect(matchesWizardOptionPhrase('테크', '재테크·투자')).toBe(false);
    expect(matchesWizardOptionPhrase('재테크', '재테크·투자')).toBe(true);
    expect(matchesWizardOptionPhrase('투자', '재테크·투자')).toBe(true);
  });
});

describe('coerceWizardActivityKindLabel', () => {
  it('coerces single segment to compound chip', () => {
    expect(coerceWizardActivityKindLabel('조깅')).toBe('러닝·조깅');
    expect(coerceWizardActivityKindLabel('테니스')).toBe('배드민턴·테니스');
  });
});

describe('coerceWizardFocusKnowledgeLabel', () => {
  it('coerces one · segment to full label', () => {
    expect(coerceWizardFocusKnowledgeLabel('스터디')).toBe('독서·스터디');
    expect(coerceWizardFocusKnowledgeLabel('카공')).toBe('카공·코워킹');
  });
});

describe('coerceWizardMenuPreferenceLabel', () => {
  it('still maps 주점 or 호프 to 주점·호프', () => {
    expect(coerceWizardMenuPreferenceLabel('주점')).toBe('주점·호프');
    expect(coerceWizardMenuPreferenceLabel('호프')).toBe('주점·호프');
  });
});
