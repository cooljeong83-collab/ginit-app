/** mulberry32 — 시드 고정 셔플(테스트·재현용) */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 탐색 피드 후기 캐러셀 노출 순서 — TanStack 캐시 순서는 유지하고 UI만 섞음.
 * @param seed 동일 시드면 동일 순서(리렌더 안정)
 */
export function shuffleFeedMeetingReviewsForDisplay<T>(items: readonly T[], seed: number): T[] {
  if (items.length <= 1) return [...items];

  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
