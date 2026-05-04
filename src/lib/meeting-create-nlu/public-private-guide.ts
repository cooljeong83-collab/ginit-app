/**
 * 모임 생성 NLU — 공개/비공개 추론 (Edge `parse-meeting-create-intent` 프롬프트와 같은 취지).
 * 애매하면 null (필드 생략).
 */
const PRIVATE_HINT =
  /여자\s*친구|남자\s*친구|여친|남친|와이프|아내|남편|부모님|가족\s*끼리|가족이랑|가족과|우리\s*둘|단둘이|둘이서|둘이만|둘이\s|친구랑\s*둘이|동생이랑|형이랑|누나랑|언니랑|오빠랑|회사\s*사람|동료와|동료랑|지인만|아는\s*형|친구\s*둘이/;

const PUBLIC_HINT =
  /모집|번개|누구나|첫\s*참가|성비|남자\s*\d|여자\s*\d|구합니다|함께\s*해요|참가자\s*모집|지역\s*모집/;

export function inferSuggestedIsPublicFromMeetingCreateText(text: string): boolean | null {
  const t = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 200) return null;
  if (PRIVATE_HINT.test(t)) return false;
  if (PUBLIC_HINT.test(t)) return true;
  return null;
}
