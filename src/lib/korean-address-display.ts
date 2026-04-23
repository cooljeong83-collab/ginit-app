/**
 * 피드 등 한 줄 주소를 행정구의 `…구`까지 잘라 표시합니다.
 * 예: `서울특별시 강남구 테헤란로 123` → `서울특별시 강남구`
 */
export function trimKoreanAddressToGuDistrict(line: string): string {
  const t = line.trim();
  if (!t) return '';
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const out: string[] = [];
  for (const p of parts) {
    out.push(p);
    if (p.length >= 2 && /[가-힣]+구$/u.test(p)) {
      return out.join(' ');
    }
  }
  if (parts.length <= 2) return t;
  return parts.slice(0, 2).join(' ');
}
