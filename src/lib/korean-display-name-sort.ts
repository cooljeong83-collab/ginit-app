const KO_DISPLAY_NAME_COLLATOR = new Intl.Collator('ko-KR', { sensitivity: 'base', numeric: true });

/** 닉네임 끝 호환 자모(예: `쌍ㄱ`의 `ㄱ`)가 ICU 정렬 순서를 어지럽히는 경우 방지 */
const TRAILING_HANGUL_JAMO = /[\u3131-\u318E]+$/;

export function koreanDisplayNameSortKey(displayName: string): string {
  const normalized = displayName.normalize('NFC').trim();
  if (!normalized) return '';
  const withoutTrailingJamo = normalized.replace(TRAILING_HANGUL_JAMO, '').trim();
  return withoutTrailingJamo || normalized;
}

/** 친구·연락처 목록용 가나다순 비교 */
export function compareKoreanDisplayNames(a: string, b: string): number {
  const ka = koreanDisplayNameSortKey(a);
  const kb = koreanDisplayNameSortKey(b);
  const byKey = KO_DISPLAY_NAME_COLLATOR.compare(ka, kb);
  if (byKey !== 0) return byKey;
  return KO_DISPLAY_NAME_COLLATOR.compare(a.normalize('NFC').trim(), b.normalize('NFC').trim());
}
