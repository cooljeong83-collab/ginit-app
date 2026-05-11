/** 영수증·결제내역 OCR 텍스트에서 정산 입력 힌트 추출 (휴리스틱) */

const TOTAL_LINE_KEYWORDS = [
  '합계',
  '총액',
  '총금액',
  '결제금액',
  '결제액',
  '매출합계',
  '승인금액',
  '받을금액',
  '주문합계',
  '결제합계',
  '납부금액',
  '청구금액',
  '거래금액',
  '판매합계',
  '합 계',
  '주문금액',
  '상품금액',
  '결제 금액',
  '총 결제',
];

/** 소액/부가 항목 — 이 줄의 `…원`은 총액 후보에서 제외 */
const TOTAL_EXCLUDE_LINE = /부가세|부가\s*가치세|VAT|할인|쿠폰|포인트|적립|배달비|배달\s*팁|봉사료|에누리|면세|공급가액|세액/i;

const ACCOUNT_LINE_HINTS = /계좌|입금|송금|이체|무통장|입금처|입금계좌|받는분/i;

const BANK_NAME_FRAGMENT = /(국민|KB|신한|우리|하나|NH|농협|기업|IBK|카카오|토스|케이뱅|케이|수협|새마을|우체국|SC제일|부산|대구|경남|광주|전북|제주|iM|아이엠)/i;

/** 휴대폰·주민 형태 줄은 금액 후보에서 제외 */
const PHONE_OR_ID_LINE = /(^|\s)(01[016789]|010)[-\s]?\d{3,4}[-\s]?\d{4}\b|\d{6}[-\s]?\d{7}\b/;

function normalizeOcrText(s: string): string {
  let t = s.normalize('NFKC');
  const fw0 = '０'.charCodeAt(0);
  for (let d = 0; d <= 9; d += 1) {
    const fw = String.fromCharCode(fw0 + d);
    t = t.split(fw).join(String(d));
  }
  t = t.replace(/，/g, ',');
  return t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function flattenOcrChunks(chunks: string[]): string[] {
  const out: string[] = [];
  for (const c of chunks) {
    if (typeof c !== 'string' || !c.trim()) continue;
    const parts = c.split(/\r?\n/);
    for (const p of parts) {
      const t = normalizeOcrText(p);
      if (t) out.push(t);
    }
  }
  return out;
}

function parseMoneyTokens(line: string): number[] {
  const compact = line.replace(/\s/g, '');
  const nums: number[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d{4,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(compact)) !== null) {
    const n = Number.parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums;
}

/** `12,500원` `12500 원` 등 — 비콤마는 3자리 이상만(연·월 등 2자리 오인 방지) */
function extractWonSuffixedAmounts(line: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d{3,})\s*원/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const n = Number.parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function isReasonableTotal(n: number): boolean {
  return n >= 100 && n <= 500_000_000;
}

function lineHasTotalKeyword(line: string): boolean {
  return TOTAL_LINE_KEYWORDS.some((k) => line.includes(k));
}

function pickLabeledTotalSingleLine(lines: string[]): number | null {
  for (const line of lines) {
    if (!line.trim() || TOTAL_EXCLUDE_LINE.test(line)) continue;
    if (!lineHasTotalKeyword(line)) continue;
    const won = extractWonSuffixedAmounts(line).filter(isReasonableTotal);
    const tok = parseMoneyTokens(line).filter(isReasonableTotal);
    const pool = [...won, ...tok];
    if (pool.length === 0) continue;
    return Math.max(...pool);
  }
  return null;
}

/** 라벨과 금액이 OCR에서 인접 줄로 끊긴 경우 */
function pickLabeledTotalMultiline(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!line.trim() || TOTAL_EXCLUDE_LINE.test(line)) continue;
    if (!lineHasTotalKeyword(line)) continue;
    if (parseMoneyTokens(line).length > 0 || extractWonSuffixedAmounts(line).length > 0) continue;

    for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j += 1) {
      const next = lines[j] ?? '';
      if (!next.trim() || lineHasTotalKeyword(next)) break;
      const won = extractWonSuffixedAmounts(next).filter(isReasonableTotal);
      const tok = parseMoneyTokens(next).filter(isReasonableTotal);
      const pool = [...won, ...tok];
      if (pool.length === 0) continue;
      return Math.max(...pool);
    }
  }
  return null;
}

function pickFromWonLines(lines: string[]): number | null {
  const candidates: number[] = [];
  for (const line of lines) {
    if (!line.trim() || TOTAL_EXCLUDE_LINE.test(line)) continue;
    if (PHONE_OR_ID_LINE.test(line)) continue;
    for (const n of extractWonSuffixedAmounts(line)) {
      if (isReasonableTotal(n)) candidates.push(n);
    }
  }
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

/** 콤마 있는 금액만(전화·카드 일부 패턴 제외) */
function pickCommaFormattedTotal(lines: string[]): number | null {
  const candidates: number[] = [];
  for (const line of lines) {
    if (!line.trim() || TOTAL_EXCLUDE_LINE.test(line)) continue;
    if (PHONE_OR_ID_LINE.test(line)) continue;
    const re = /\d{1,3}(?:,\d{3})+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const n = Number.parseInt(m[0].replace(/,/g, ''), 10);
      if (isReasonableTotal(n)) candidates.push(n);
    }
  }
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function normalizeAccountLine(raw: string): string | null {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (t.length < 6 || t.length > 200) return null;
  return t;
}

function tryExtractAccountHint(lines: string[]): string | null {
  for (const line of lines) {
    if (ACCOUNT_LINE_HINTS.test(line) && /\d/.test(line)) {
      const n = normalizeAccountLine(line);
      if (n) return n;
    }
  }
  for (const line of lines) {
    if (BANK_NAME_FRAGMENT.test(line) && /\d{3,}/.test(line)) {
      const n = normalizeAccountLine(line);
      if (n) return n;
    }
  }
  return null;
}

export function parseSettlementReceiptOcrText(chunks: string[]): {
  totalWon: number | null;
  accountHint: string | null;
} {
  const lines = flattenOcrChunks(chunks);
  const single = pickLabeledTotalSingleLine(lines);
  const multi = pickLabeledTotalMultiline(lines);
  const wonLines = pickFromWonLines(lines);
  const comma = pickCommaFormattedTotal(lines);

  const totalWon: number | null = single ?? multi ?? wonLines ?? comma;

  const accountHint = tryExtractAccountHint(lines);
  return { totalWon, accountHint };
}
