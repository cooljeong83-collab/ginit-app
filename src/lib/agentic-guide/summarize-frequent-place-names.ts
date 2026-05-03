import type { Meeting } from '@/src/lib/meetings';

import type { FrequentPlaceSummary } from '@/src/lib/agentic-guide/types';

function placeTokens(m: Meeting): string[] {
  const parts: string[] = [];
  const pn = (m.placeName ?? '').trim();
  const ad = (m.address ?? '').trim();
  const loc = (m.location ?? '').trim();
  if (pn) parts.push(pn);
  if (ad && ad !== pn) parts.push(ad);
  if (loc && loc !== pn && loc !== ad) parts.push(loc);
  const rows = m.placeCandidates ?? [];
  for (const r of rows) {
    const n = (r.placeName ?? '').trim();
    if (n) parts.push(n);
  }
  return parts;
}

/**
 * 완료·진행 모임 장소 문자열 빈도 — 검색 쿼리 후보.
 */
export function summarizeFrequentPlaceNames(meetings: Meeting[], maxScan = 40): FrequentPlaceSummary | null {
  const freq = new Map<string, number>();
  for (const m of meetings.slice(0, maxScan)) {
    for (const t of placeTokens(m)) {
      const key = t.trim();
      if (key.length < 2) continue;
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  if (freq.size === 0) return null;
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const [top, n] = sorted[0]!;
  return {
    displayQuery: top,
    searchQuery: top,
    hitCount: n,
  };
}
