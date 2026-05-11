import { describe, expect, it } from 'vitest';

import { validateSettlementReceiptOcrChunks } from '@/src/lib/settlement-receipt-ocr-guard';

describe('validateSettlementReceiptOcrChunks', () => {
  it('결제 금액 키워드가 있는 영수증 OCR은 통과시킵니다', () => {
    const result = validateSettlementReceiptOcrChunks(['카페 지닛', '아메리카노 4,500', '결제금액 4,500원']);

    expect(result.ok).toBe(true);
  });

  it('짧은 합계 라인만 인식된 경우도 영수증 후보로 통과시킵니다', () => {
    const result = validateSettlementReceiptOcrChunks(['합계 12,500원']);

    expect(result.ok).toBe(true);
  });

  it('사업자번호와 금액이 있는 영수증 OCR은 통과시킵니다', () => {
    const result = validateSettlementReceiptOcrChunks(['상호 지닛식당', '사업자번호 123-45-67890', '합계 32,000원']);

    expect(result.ok).toBe(true);
  });

  it('영수증 신호가 없는 일반 문자열은 차단합니다', () => {
    const result = validateSettlementReceiptOcrChunks(['오늘의 할 일', '회의 준비', '오후 3시까지 정리']);

    expect(result.ok).toBe(false);
  });

  it('금액처럼 보이는 숫자만 있는 사진은 차단합니다', () => {
    const result = validateSettlementReceiptOcrChunks(['주차 구역 10000', 'A동 1203호']);

    expect(result.ok).toBe(false);
  });
});
