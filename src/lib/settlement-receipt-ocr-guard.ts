export type SettlementReceiptOcrReceiptGuardResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
    };

function normalizeOcrText(chunks: string[]): string {
  return chunks
    .map((x) => x.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[，]/g, ',')
    .trim();
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function validateSettlementReceiptOcrChunks(chunks: string[]): SettlementReceiptOcrReceiptGuardResult {
  const text = normalizeOcrText(chunks);
  const compact = text.replace(/\s+/g, '');

  if (compact.length < 8) {
    return {
      ok: false,
      message: '영수증 글씨가 충분히 인식되지 않았어요. 영수증 전체가 보이게 다시 촬영해 주세요.',
    };
  }

  const moneyCount = countMatches(compact, /(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:원)?/g);
  const hasBusinessNumber = /\d{3}-?\d{2}-?\d{5}/.test(compact);
  const amountKeywordCount = countMatches(
    compact,
    /(합계|총액|총금액|결제금액|결제액|받을금액|승인금액|청구금액|판매금액)/g,
  );
  const receiptKeywordCount = countMatches(
    compact,
    /(영수증|매출전표|카드전표|현금영수증|신용카드|가맹점|사업자|대표자|상호|부가세|과세|면세|공급가액|승인번호|승인일시)/g,
  );
  const itemKeywordCount = countMatches(compact, /(품목|메뉴|수량|단가|주문|테이블|포장|매장)/g);

  const receiptScore =
    amountKeywordCount * 2 +
    receiptKeywordCount * 2 +
    itemKeywordCount +
    (hasBusinessNumber ? 2 : 0) +
    (moneyCount >= 2 ? 1 : 0);

  if (moneyCount < 1 || receiptScore < 2) {
    return {
      ok: false,
      message: '영수증 형식의 사진이 아니거나 결제 금액을 확인할 수 없어요. 영수증 사진을 다시 선택해 주세요.',
    };
  }

  return { ok: true };
}
