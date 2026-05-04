/**
 * 최종 요약 컨펌 단계에서 사용자가 “요약이 틀렸다”고 할 때 (짧은 부정).
 */
export function isMeetingCreateNluSummaryRejectionText(text: string): boolean {
  const t = text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t || t.length > 32) return false;
  if (/^(아니|아니요|아닌데|틀렸어|틀렸|틀려|다른데|맞지\s*않|no|nope)(요|야|요요)?$/i.test(t)) return true;
  if (t === 'no' || t === 'nope') return true;
  return false;
}
