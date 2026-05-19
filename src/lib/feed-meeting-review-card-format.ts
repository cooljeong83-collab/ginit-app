/** 행정구역 토큰(도·특별/광역시·시·구) — 선두에서만 제거 */
const FEED_REVIEW_ADMIN_LOCATION_TOKEN = /^(?:[가-힣]{1,20}(?:특별자치시|특별자치도|특별시|광역시|도|시|군|구))$/;

/** 피드 후기 카드 주소 — 시·구(·도) 제외한 나머지(동·로·길·번지 등)만 */
export function formatFeedReviewLocationDetail(raw: string | null | undefined): string | null {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!t) return null;

  const parts = t.split(' ').filter(Boolean);
  while (parts.length > 0 && FEED_REVIEW_ADMIN_LOCATION_TOKEN.test(parts[0]!)) {
    parts.shift();
  }

  const rest = parts.join(' ').trim();
  return rest.length > 0 ? rest : null;
}

/** 피드 후기 카드 — 👥 김한나 외 3명 */
export function formatFeedReviewParticipantLabel(
  firstName: string | null | undefined,
  participantCount: number,
): string | null {
  const name = firstName?.trim();
  if (!name || participantCount < 1) return null;
  if (participantCount <= 1) return name;
  return `${name} 외 ${participantCount - 1}명`;
}
