function parseFeedReviewCommentEntry(entry: unknown): string {
  if (typeof entry === 'string') return entry.trim();
  if (entry && typeof entry === 'object') {
    const o = entry as Record<string, unknown>;
    for (const key of ['comment', 'text', 'body'] as const) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}

/** RPC comments[] — 모임별 전체 코멘트(순서 유지), 레거시는 comment 단일 폴백 */
export function parseFeedReviewCommentsField(raw: unknown, fallbackComment: string): string[] {
  const out: string[] = [];

  const push = (s: string) => {
    const t = s.trim();
    if (t) out.push(t);
  };

  if (Array.isArray(raw)) {
    for (const entry of raw) push(parseFeedReviewCommentEntry(entry));
  } else if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(t);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) push(parseFeedReviewCommentEntry(entry));
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (out.length === 0) push(fallbackComment);
  return out;
}
