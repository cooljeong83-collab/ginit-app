import { describe, expect, it } from 'vitest';

import { generateUuidV4, isUuidV4 } from '@/src/lib/generate-uuid-v4';

describe('generateUuidV4', () => {
  it('returns RFC 4122 v4 shape', () => {
    expect(isUuidV4(generateUuidV4())).toBe(true);
  });

  it('rejects legacy timestamp intent ids', () => {
    expect(isUuidV4('1779336960059_tqm81czuy')).toBe(false);
  });
});
