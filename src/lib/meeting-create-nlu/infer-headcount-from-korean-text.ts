/**
 * Edge가 인원을 빠뜨릴 때 보조용 — 짧은 한국어 패턴만(오탐 최소화).
 */
export function inferMeetingCreateHeadcountFromKoreanText(text: string): {
  minParticipants: number;
  maxParticipants: number;
} | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const range = /^(\d{1,2})\s*~\s*(\d{1,2})\s*명\s*$/.exec(t);
  if (range) {
    let a = parseInt(range[1]!, 10);
    let b = parseInt(range[2]!, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (a > b) [a, b] = [b, a];
    a = Math.min(99, Math.max(1, a));
    b = Math.min(99, Math.max(1, b));
    if (a >= 1 && b >= a) return { minParticipants: a, maxParticipants: b };
  }

  const single = /^(\d{1,2})\s*명\s*$/.exec(t);
  if (single) {
    const n = Math.min(99, Math.max(1, parseInt(single[1]!, 10)));
    if (!Number.isFinite(n)) return null;
    return { minParticipants: n, maxParticipants: n };
  }

  // 문장 중간 인원 표현(예: "친구 5명이서", "5명 모일거야")도 인원으로 인식합니다.
  // 날짜/시간(예: "3시", "5월") 등과의 오탐을 줄이기 위해 "명" 뒤에 참여 맥락 토큰이 붙은 경우만 허용합니다.
  const inlineCount = /(?:^|\s)(\d{1,2})\s*명(?:이서|이랑|과|이|정도|쯤|모여|모일|참석)/.exec(t);
  if (inlineCount) {
    const n = Math.min(99, Math.max(1, parseInt(inlineCount[1]!, 10)));
    if (!Number.isFinite(n)) return null;
    return { minParticipants: n, maxParticipants: n };
  }

  if (
    /(?:둘이서|단둘이|둘이만|둘이\s|둘이$|두\s*명|2\s*명|둘이\s*만남|둘이서\s*만남|둘이\s*만나|친구랑\s*둘이)/.test(t)
  ) {
    return { minParticipants: 2, maxParticipants: 2 };
  }
  if (/(?:혼자|나\s*혼자|한\s*명|1\s*명)/.test(t)) {
    return { minParticipants: 1, maxParticipants: 1 };
  }
  if (/(?:셋이서|셋이|세\s*명|3\s*명)/.test(t)) {
    return { minParticipants: 3, maxParticipants: 3 };
  }
  if (/(?:넷이|네\s*명|4\s*명)/.test(t)) {
    return { minParticipants: 4, maxParticipants: 4 };
  }

  // 성비 모집 "3대3" "4 대 4" "2:2" → 총원 n+m (남 n + 여 m)
  const ndn = /(\d{1,2})\s*[대:]\s*(\d{1,2})(?!\s*명)/.exec(t);
  if (ndn) {
    let a = parseInt(ndn[1]!, 10);
    let b = parseInt(ndn[2]!, 10);
    if (Number.isFinite(a) && Number.isFinite(b) && a >= 1 && a <= 30 && b >= 1 && b <= 30) {
      const total = Math.min(99, a + b);
      if (total >= 2) return { minParticipants: total, maxParticipants: total };
    }
  }

  return null;
}
