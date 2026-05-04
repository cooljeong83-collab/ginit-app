import { getPolicy } from '@/src/lib/app-policies-store';

type NluBlockedPolicy = {
  phrases?: unknown;
  userMessage?: unknown;
};

function normalizeForMatch(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** `app_policies` `meeting_create` / `nlu_blocked` — 마이그레이션 시드와 `DEFAULTS` 정합 */
export function getMeetingCreateNluBlockedPolicy(): { phrases: string[]; userMessage: string } {
  const raw = getPolicy<NluBlockedPolicy | null>('meeting_create', 'nlu_blocked', null);
  const phrasesIn = raw && Array.isArray(raw.phrases) ? raw.phrases : [];
  const phrases = phrasesIn
    .map((p) => (typeof p === 'string' ? p.normalize('NFKC').trim() : ''))
    .filter((p) => p.length > 0);
  const userMessage =
    typeof raw?.userMessage === 'string' && raw.userMessage.trim()
      ? raw.userMessage.trim()
      : '이 내용으로는 모임을 만들 수 없어요. 커뮤니티 가이드에 맞는 모임만 만들 수 있어요.';
  return { phrases, userMessage };
}

export function isMeetingCreateNaturalLanguageBlocked(text: string): { blocked: true; message: string } | { blocked: false } {
  const { phrases, userMessage } = getMeetingCreateNluBlockedPolicy();
  if (phrases.length === 0) return { blocked: false };
  const norm = normalizeForMatch(text);
  if (!norm) return { blocked: false };
  for (const p of phrases) {
    const q = normalizeForMatch(p);
    if (q && norm.includes(q)) return { blocked: true, message: userMessage };
  }
  return { blocked: false };
}
