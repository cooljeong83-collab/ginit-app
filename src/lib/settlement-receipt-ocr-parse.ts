/** 영수증·결제내역 OCR 텍스트에서 정산 입력 힌트 추출 (휴리스틱) */

import type { SettlementReceiptOcrAnalysis } from '@/src/lib/settlement-receipt-ocr-types';

type LegacyReceiptItem = {
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
};

type LegacyReceiptDiscount = {
  name: string;
  amount: number;
};

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

const DISCOUNT_LINE = /할인|DC|Coupon|Promotion|쿠폰|포인트\s*사용|에누리|프로모션/i;
const TAX_LINE = /부가세|부가\s*가치세|VAT|세액|tax/i;
const SERVICE_FEE_LINE = /봉사료|service\s*fee|service/i;
const SUPPLY_AMOUNT_LINE = /공급가액|면세|과세물품가액/i;
const RECEIPT_DATE_LINE =
  /(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})(?:일)?(?:\s+(\d{1,2})[:시]\s*(\d{2})?)?|\b(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/;

const FINAL_PAYMENT_KEYWORDS: readonly { keyword: string; score: number }[] = [
  { keyword: '받을금액', score: 100 },
  { keyword: '받을 금액', score: 100 },
  { keyword: '실결제', score: 95 },
  { keyword: '결제금액', score: 92 },
  { keyword: '결제 금액', score: 92 },
  { keyword: '결제액', score: 90 },
  { keyword: '승인금액', score: 88 },
  { keyword: '승인 금액', score: 88 },
  { keyword: '카드승인', score: 86 },
  { keyword: '현금영수', score: 80 },
  { keyword: '총 결제', score: 78 },
  { keyword: '결제합계', score: 76 },
  { keyword: '합계', score: 55 },
  { keyword: '합 계', score: 55 },
  { keyword: '총액', score: 52 },
  { keyword: '총금액', score: 52 },
  { keyword: '주문합계', score: 45 },
  { keyword: '상품금액', score: 35 },
];

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

function uniqueMoneyAmounts(amounts: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const n of amounts) {
    if (!Number.isFinite(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function extractLineAmounts(line: string): number[] {
  return uniqueMoneyAmounts([...extractWonSuffixedAmounts(line), ...parseMoneyTokens(line)]);
}

function extractSignedLineAmounts(line: string): { value: number; explicitNegative: boolean }[] {
  const compact = line.replace(/\s/g, '');
  const out: { value: number; explicitNegative: boolean }[] = [];
  const re = /([+-]?)(\d{1,3}(?:,\d{3})+|\d{3,})(?:원)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(compact)) !== null) {
    const n = Number.parseInt(m[2]!.replace(/,/g, ''), 10);
    if (!Number.isFinite(n)) continue;
    const negative = m[1] === '-';
    out.push({ value: negative ? -n : n, explicitNegative: negative });
  }
  return out;
}

function isReasonableTotal(n: number): boolean {
  return n >= 100 && n <= 500_000_000;
}

function lineHasTotalKeyword(line: string): boolean {
  return TOTAL_LINE_KEYWORDS.some((k) => line.includes(k));
}

function compactKeywordText(line: string): string {
  return line.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function finalPaymentKeywordScore(line: string): number {
  const compact = compactKeywordText(line);
  let score = 0;
  for (const { keyword, score: s } of FINAL_PAYMENT_KEYWORDS) {
    const k = compactKeywordText(keyword);
    if (k && compact.includes(k)) score = Math.max(score, s);
  }
  return score;
}

function shouldExcludeFinalPaymentLine(line: string): boolean {
  return DISCOUNT_LINE.test(line) || TAX_LINE.test(line) || SERVICE_FEE_LINE.test(line) || SUPPLY_AMOUNT_LINE.test(line);
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

function pickActualPayment(lines: string[]): number | null {
  let best: { value: number; rank: number } | null = null;

  const offer = (value: number, rank: number) => {
    if (!isReasonableTotal(value)) return;
    if (!best || rank > best.rank) best = { value, rank };
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!line.trim() || shouldExcludeFinalPaymentLine(line) || PHONE_OR_ID_LINE.test(line)) continue;
    const score = finalPaymentKeywordScore(line);
    if (score <= 0) continue;

    const amounts = extractLineAmounts(line).filter(isReasonableTotal);
    if (amounts.length > 0) {
      offer(Math.max(...amounts), score * 10_000 + i);
      continue;
    }

    for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j += 1) {
      const next = lines[j] ?? '';
      if (!next.trim() || shouldExcludeFinalPaymentLine(next) || lineHasTotalKeyword(next)) break;
      const nextAmounts = extractLineAmounts(next).filter(isReasonableTotal);
      if (nextAmounts.length > 0) {
        offer(Math.max(...nextAmounts), score * 10_000 + i - (j - i));
        break;
      }
    }
  }

  return best?.value ?? null;
}

function parseReceiptDate(lines: string[]): string | null {
  for (const line of lines) {
    const m = RECEIPT_DATE_LINE.exec(line);
    if (!m) continue;
    if (m[1] && m[2] && m[3]) {
      const yyyy = m[1].padStart(4, '0');
      const mm = m[2].padStart(2, '0');
      const dd = m[3].padStart(2, '0');
      const hh = (m[4] ?? '00').padStart(2, '0');
      const min = (m[5] ?? '00').padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    }
    if (m[6] && m[7] && m[8]) {
      const yy = Number.parseInt(m[6], 10);
      const yyyy = String(yy >= 70 ? 1900 + yy : 2000 + yy);
      const mm = m[7].padStart(2, '0');
      const dd = m[8].padStart(2, '0');
      const hh = (m[9] ?? '00').padStart(2, '0');
      const min = (m[10] ?? '00').padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    }
  }
  return null;
}

function parseStoreName(lines: string[]): string | null {
  for (const line of lines.slice(0, 8)) {
    const t = line.trim();
    if (t.length < 2 || t.length > 80) continue;
    if (extractLineAmounts(t).length > 0 || RECEIPT_DATE_LINE.test(t)) continue;
    if (ACCOUNT_LINE_HINTS.test(t) || lineHasTotalKeyword(t) || DISCOUNT_LINE.test(t) || TAX_LINE.test(t)) continue;
    return t;
  }
  return null;
}

function cleanReceiptLineName(line: string): string {
  const cleaned = line
    .replace(/[+-]?\d{1,3}(?:,\d{3})+(?:\s*원)?/g, ' ')
    .replace(/[+-]?\d{3,}(?:\s*원)/g, ' ')
    .replace(/\b[xX]\s*\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}\s*(개|잔|병|인분|EA|ea)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

function parseItemQuantity(line: string, unitPrice: number | null, totalPrice: number): number {
  const explicit =
    /(?:^|\s)[xX]\s*(\d{1,2})(?:\s|$)/.exec(line)?.[1] ??
    /(?:^|\s)(\d{1,2})\s*(?:개|잔|병|인분|EA|ea)(?:\s|$)/.exec(line)?.[1];
  if (explicit) {
    const q = Number.parseInt(explicit, 10);
    if (Number.isFinite(q) && q > 0 && q <= 99) return q;
  }
  if (unitPrice != null && unitPrice > 0 && totalPrice >= unitPrice && totalPrice % unitPrice === 0) {
    const q = totalPrice / unitPrice;
    if (q >= 1 && q <= 99) return q;
  }
  return 1;
}

function parseReceiptItemLine(line: string): LegacyReceiptItem | null {
  if (!line.trim() || PHONE_OR_ID_LINE.test(line)) return null;
  if (lineHasTotalKeyword(line) || TOTAL_EXCLUDE_LINE.test(line) || ACCOUNT_LINE_HINTS.test(line)) return null;
  if (RECEIPT_DATE_LINE.test(line)) return null;
  const amounts = extractLineAmounts(line).filter(isReasonableTotal);
  if (amounts.length === 0) return null;
  const totalPrice = amounts[amounts.length - 1]!;
  const unitCandidate = amounts.length >= 2 ? amounts[amounts.length - 2]! : null;
  const quantity = parseItemQuantity(line, unitCandidate, totalPrice);
  const unitPrice =
    unitCandidate != null && quantity > 1 && unitCandidate * quantity === totalPrice
      ? unitCandidate
      : quantity > 1 && totalPrice % quantity === 0
        ? totalPrice / quantity
        : totalPrice;
  const name = cleanReceiptLineName(line);
  if (!/[가-힣A-Za-z]/.test(name)) return null;
  return { name, quantity, unit_price: Math.trunc(unitPrice), total_price: Math.trunc(totalPrice) };
}

function parseReceiptDiscountLine(line: string): LegacyReceiptDiscount | null {
  if (!line.trim() || PHONE_OR_ID_LINE.test(line)) return null;
  const signed = extractSignedLineAmounts(line).filter((x) => isReasonableTotal(Math.abs(x.value)));
  const hasDiscountKeyword = DISCOUNT_LINE.test(line);
  const negative = signed.find((x) => x.explicitNegative && x.value < 0);
  if (!hasDiscountKeyword && !negative) return null;
  if (/적립/.test(line) && !negative && !/사용|할인|쿠폰|DC/i.test(line)) return null;
  const picked = negative?.value ?? signed[signed.length - 1]?.value;
  if (picked == null || picked === 0) return null;
  const amount = picked < 0 ? picked : -Math.abs(picked);
  return { name: cleanReceiptLineName(line) || '할인', amount };
}

function sumLineAmountByKind(lines: string[], kind: 'tax' | 'service'): number {
  const re = kind === 'tax' ? TAX_LINE : SERVICE_FEE_LINE;
  let sum = 0;
  for (const line of lines) {
    if (!re.test(line) || SUPPLY_AMOUNT_LINE.test(line)) continue;
    const amounts = extractLineAmounts(line).filter((n) => isReasonableTotal(Math.abs(n)));
    if (amounts.length === 0) continue;
    sum += Math.max(...amounts);
  }
  return sum;
}

function moneyDigits(n: number): string {
  return String(Math.abs(Math.trunc(n)));
}

function looksLikeSingleDigitOcrCorrection(from: number, to: number): boolean {
  const a = moneyDigits(from);
  const b = moneyDigits(to);
  if (a.length !== b.length || a === b) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diff += 1;
  }
  return diff === 1;
}

function applySingleItemCorrection(params: {
  items: LegacyReceiptItem[];
  discountTotal: number;
  taxAndService: number;
  actualPayment: number | null;
}): string | null {
  const { items, discountTotal, taxAndService, actualPayment } = params;
  if (actualPayment == null || items.length !== 1) return null;
  const item = items[0]!;
  const desiredTotal = actualPayment - discountTotal - taxAndService;
  if (!isReasonableTotal(desiredTotal) || desiredTotal <= 0) return null;
  if (!looksLikeSingleDigitOcrCorrection(item.total_price, desiredTotal)) return null;
  const before = item.total_price;
  item.total_price = Math.trunc(desiredTotal);
  item.unit_price =
    item.quantity > 1 && item.total_price % item.quantity === 0 ? item.total_price / item.quantity : item.total_price;
  return `OCR 숫자 오인 가능성으로 '${before}'을 '${item.total_price}'으로 교정함.`;
}

function buildFixNotes(params: {
  verified: boolean;
  correctedNote: string | null;
  matchedWithoutTax: boolean;
  taxAndService: number;
  itemCount: number;
  actualPayment: number | null;
  calculatedTotal: number | null;
}): string {
  if (params.correctedNote) return params.correctedNote;
  if (params.verified && params.matchedWithoutTax && params.taxAndService > 0) {
    return '부가세/봉사료가 품목 금액에 포함된 것으로 보고 검증함.';
  }
  if (params.verified) return '산술 검증 완료.';
  if (params.actualPayment == null) return '최종 결제액을 찾지 못함.';
  if (params.itemCount === 0) return '품목 합계를 충분히 읽지 못해 최종 결제액만 사용함.';
  if (params.calculatedTotal != null) {
    return `산술 불일치: 계산값 ${params.calculatedTotal}원, 결제액 ${params.actualPayment}원.`;
  }
  return '산술 검증에 필요한 금액 정보를 충분히 읽지 못함.';
}

function inferReviewTags(name: string): string[] {
  const tags: string[] = [];
  const add = (tag: string) => {
    if (!tags.includes(tag)) tags.push(tag);
  };
  add('메인');
  if (/치즈/i.test(name)) add('치즈');
  if (/매운|마라|불닭|핫/i.test(name)) add('매운맛');
  if (/라멘|라면|우동|국수|파스타|면/i.test(name)) add('면');
  if (/커피|라떼|에이드|주스|음료|차\b/i.test(name)) add('음료');
  if (/케이크|디저트|빙수|아이스크림|쿠키/i.test(name)) add('디저트');
  return tags.slice(0, 8);
}

function buildSettlementReceiptOcrAnalysis(lines: string[], fallbackTotalWon: number | null): SettlementReceiptOcrAnalysis {
  const items = lines.map(parseReceiptItemLine).filter((x): x is LegacyReceiptItem => x != null);
  const discounts = lines
    .map(parseReceiptDiscountLine)
    .filter((x): x is LegacyReceiptDiscount => x != null);
  const tax = sumLineAmountByKind(lines, 'tax');
  const serviceFee = sumLineAmountByKind(lines, 'service');
  const actualPayment = pickActualPayment(lines) ?? fallbackTotalWon;

  const discountTotal = discounts.reduce((s, x) => s + x.amount, 0);
  const taxAndService = tax + serviceFee;
  let correctedNote = applySingleItemCorrection({ items, discountTotal, taxAndService, actualPayment });
  let itemsTotal = items.reduce((s, x) => s + x.total_price, 0);
  let calculatedWithTax = items.length > 0 ? itemsTotal + discountTotal + taxAndService : null;
  let calculatedWithoutTax = items.length > 0 ? itemsTotal + discountTotal : null;
  let matchedWithoutTax = false;
  let verified =
    actualPayment != null &&
    (calculatedWithTax === actualPayment ||
      (calculatedWithoutTax === actualPayment && ((matchedWithoutTax = true), true)));

  if (!verified && correctedNote == null && taxAndService > 0) {
    correctedNote = applySingleItemCorrection({ items, discountTotal, taxAndService: 0, actualPayment });
    itemsTotal = items.reduce((s, x) => s + x.total_price, 0);
    calculatedWithTax = items.length > 0 ? itemsTotal + discountTotal + taxAndService : null;
    calculatedWithoutTax = items.length > 0 ? itemsTotal + discountTotal : null;
    matchedWithoutTax = false;
    verified =
      actualPayment != null &&
      (calculatedWithTax === actualPayment ||
        (calculatedWithoutTax === actualPayment && ((matchedWithoutTax = true), true)));
  }

  const calculatedTotal =
    verified && matchedWithoutTax ? calculatedWithoutTax : calculatedWithTax ?? calculatedWithoutTax ?? actualPayment;
  const fixNotes = buildFixNotes({
    verified,
    correctedNote,
    matchedWithoutTax,
    taxAndService,
    itemCount: items.length,
    actualPayment,
    calculatedTotal,
  });
  void fixNotes;

  return {
    verification: {
      biz_num: null,
      store_name: parseStoreName(lines),
      datetime: parseReceiptDate(lines),
    },
    review_source: {
      items: items.map((item) => ({ name: item.name, tags: inferReviewTags(item.name) })),
    },
    billing: {
      total_amount: actualPayment ?? calculatedTotal,
      is_verified: verified,
    },
  };
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
  analysis: SettlementReceiptOcrAnalysis;
} {
  const lines = flattenOcrChunks(chunks);
  const single = pickLabeledTotalSingleLine(lines);
  const multi = pickLabeledTotalMultiline(lines);
  const wonLines = pickFromWonLines(lines);
  const comma = pickCommaFormattedTotal(lines);

  const fallbackTotalWon: number | null = single ?? multi ?? wonLines ?? comma;
  const analysis = buildSettlementReceiptOcrAnalysis(lines, fallbackTotalWon);
  const totalWon: number | null = analysis.billing.total_amount ?? fallbackTotalWon;

  const accountHint = tryExtractAccountHint(lines);
  return { totalWon, accountHint, analysis };
}
