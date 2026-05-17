/**
 * 피드·모임 생성 장소 검증용 지역 문자열 매칭 — React Native / expo 의존 없음(vitest·공유 로직).
 */

export function extractGuFromKoreanAddressText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/([가-힣]{1,20}구)(?=\s|$|[^가-힣])/);
  return m ? m[1] : null;
}

export function normalizeFeedRegionLabel(label: string): string {
  const t = label.trim();
  if (!t) return '';
  const two = t.split(/\s+/).filter(Boolean);
  if (two.length === 2 && /구$/.test(two[1]!) && two[1]!.length >= 2 && !/^서울/i.test(two[0]!) && !/^seoul$/i.test(two[0]!)) {
    return t;
  }
  return extractGuFromKoreanAddressText(t) ?? t;
}

export function haystackMatchesFeedRegion(hayRaw: string, regionLabel: string): boolean {
  const sel = normalizeFeedRegionLabel(regionLabel);
  if (!sel) return true;
  const hay = hayRaw.replace(/\s+/g, ' ').trim();
  if (!hay) return false;

  const parts = sel.split(/\s+/).filter(Boolean);
  if (parts.length === 2 && /구$/.test(parts[1]!) && !/^서울/i.test(parts[0]!) && !/^seoul$/i.test(parts[0]!)) {
    const [cityShort, gu] = parts as [string, string];
    if (!hay.includes(gu)) return false;
    return hay.includes(cityShort);
  }

  const selGu = extractGuFromKoreanAddressText(sel) ?? sel;
  const mGu = extractGuFromKoreanAddressText(hay);
  if (mGu && selGu.endsWith('구')) return mGu === selGu;
  return hay.includes(sel) || hay.includes(selGu);
}
