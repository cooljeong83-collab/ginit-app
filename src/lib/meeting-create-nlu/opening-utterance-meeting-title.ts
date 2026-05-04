import type { Category } from '@/src/lib/categories';
import { isAreaOnlyPlaceQuery } from '@/src/lib/meeting-create-nlu/local-intent-patch';
import { peekMeetingCreateNluMissingSlots } from '@/src/lib/meeting-create-nlu/parse-edge-payload';

/**
 * 첫 자연어 발화에서 일정·말머리만 덜어낸 뒤 모임 제목 폴백으로 쓸 한 줄을 만듭니다.
 * Edge가 `title`을 비울 때 `mergeMeetingCreateNluAccumulatedWithAutoTitle`에 넘깁니다.
 */
export function deriveMeetingTitleFromOpeningUtterance(text: string): string {
  let t = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const original = t;
  for (let i = 0; i < 24; i += 1) {
    const before = t;
    t = t
      .replace(/^(?:오늘|내일|모레|글피|명일|익일|모래)\s+/u, '')
      .replace(/^(?:다음\s*주|이번\s*주|주말|평일)\s+/u, '')
      .replace(/^(?:오전|오후|저녁|밤|새벽|점심|아침|이따)\s+/u, '')
      .replace(/^\d{1,2}\s*:\s*\d{1,2}\s*/, '')
      .replace(/^\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?\s*/u, '')
      .trim();
    if (t === before) break;
  }
  if (t.length >= 2) return t;
  return original.length > 80 ? original.slice(0, 80).trim() : original;
}

export type SanitizeMeetingCreateNluPatchForVenueFollowUpArgs = {
  categories: Category[];
  beforeAcc: Record<string, unknown>;
  raw: string;
  now: Date;
  /** 현재 턴 append 직전 사용자 발화 수(첫 턴은 0) */
  priorUserTurns: number;
};

/**
 * 역·동만 있고 `placeVenue`만 비는 흐름에서, 업종 한마디(술집 등) 답이 `title`로 덮이는 것을 막습니다.
 */
export function sanitizeMeetingCreateNluPatchForVenueFollowUp(
  patch: Record<string, unknown>,
  args: SanitizeMeetingCreateNluPatchForVenueFollowUpArgs,
): Record<string, unknown> {
  const { categories, beforeAcc, raw, now, priorUserTurns } = args;
  if (priorUserTurns < 1) return patch;
  const rt = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (/(?:제목|모임\s*이름|타이틀)/u.test(rt)) return patch;

  const missing = peekMeetingCreateNluMissingSlots(categories, beforeAcc, now);
  if (!missing.includes('placeVenue')) return patch;

  const placeQ = String(
    beforeAcc.placeAutoPickQuery ?? (beforeAcc as Record<string, unknown>)['장소'] ?? '',
  ).trim();
  if (!isAreaOnlyPlaceQuery(placeQ)) return patch;

  const out = { ...patch };
  delete out.title;
  delete out['이름'];
  return out;
}
