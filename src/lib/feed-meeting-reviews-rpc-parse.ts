/** Supabase jsonb RPC — 빈 결과·null·`[]` 문자열 등 정상 빈 페이로드 */
export function isFeedMeetingReviewsRpcEmptyPayload(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'string') {
    const t = data.trim();
    return t === '' || t === '[]' || t === 'null';
  }
  return false;
}

/** Supabase jsonb RPC — 배열·JSON 문자열 모두 수용 */
export function parseFeedMeetingReviewsRpcJsonbRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 빈 배열이 아닌데 파싱 결과가 0건이면 비정상 페이로드 */
export function isFeedMeetingReviewsRpcPayloadUnexpected(data: unknown, rowCount: number): boolean {
  if (rowCount > 0) return false;
  if (isFeedMeetingReviewsRpcEmptyPayload(data)) return false;
  return true;
}
