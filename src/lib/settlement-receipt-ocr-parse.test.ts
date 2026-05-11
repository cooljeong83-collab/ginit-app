import { describe, expect, it } from 'vitest';

import { parseSettlementReceiptOcrText } from '@/src/lib/settlement-receipt-ocr-parse';

describe('parseSettlementReceiptOcrText', () => {
  it('합계 라인에서 총액을 고릅니다', () => {
    const r = parseSettlementReceiptOcrText(['카페', '합계 12,500원', '부가세 별도']);
    expect(r.totalWon).toBe(12500);
  });

  it('부가세 줄의 원 금액이 합계보다 우선하지 않습니다', () => {
    const r = parseSettlementReceiptOcrText(['부가세 1,136원', '합계 12,500원']);
    expect(r.totalWon).toBe(12500);
  });

  it('합계와 금액이 인접 줄로 끊긴 경우를 봅니다', () => {
    const r = parseSettlementReceiptOcrText(['합계', '15,000원']);
    expect(r.totalWon).toBe(15000);
  });

  it('전각 숫자를 정규화합니다', () => {
    const r = parseSettlementReceiptOcrText(['합계 １２，５００원']);
    expect(r.totalWon).toBe(12500);
  });

  it('총액 키워드 변형을 인식합니다', () => {
    const r = parseSettlementReceiptOcrText(['결제금액: 42,000 원']);
    expect(r.totalWon).toBe(42000);
  });

  it('계좌 힌트가 있으면 반환합니다', () => {
    const r = parseSettlementReceiptOcrText(['입금계좌 국민 123456-12-1234567 홍길동']);
    expect(r.accountHint).toBeTruthy();
    expect(r.accountHint).toContain('국민');
  });

  it('품목 합계와 할인으로 결제액을 검증합니다', () => {
    const r = parseSettlementReceiptOcrText(['카페 지닛', '아메리카노 2개 4,500 9,000', '쿠폰할인 -1,000', '결제금액 8,000원']);
    expect(r.totalWon).toBe(8000);
    expect(r.analysis.review_source.items).toHaveLength(1);
    expect(r.analysis.review_source.items[0]?.name).toContain('아메리카노');
    expect(r.analysis.billing.total_amount).toBe(8000);
    expect(r.analysis.billing.is_verified).toBe(true);
  });

  it('부가세와 봉사료를 더해 결제액을 검증합니다', () => {
    const r = parseSettlementReceiptOcrText(['레스토랑', '파스타 1개 10,000', '부가세 1,000원', '봉사료 500원', '받을 금액', '11,500원']);
    expect(r.totalWon).toBe(11500);
    expect(r.analysis.verification.store_name).toBe('레스토랑');
    expect(r.analysis.billing.total_amount).toBe(11500);
    expect(r.analysis.billing.is_verified).toBe(true);
  });

  it('산술이 맞지 않으면 확인 필요로 표시합니다', () => {
    const r = parseSettlementReceiptOcrText(['메뉴 1개 10,000', '할인 -1,000', '결제금액 8,000원']);
    expect(r.totalWon).toBe(8000);
    expect(r.analysis.billing.total_amount).toBe(8000);
    expect(r.analysis.billing.is_verified).toBe(false);
  });

  it('단일 품목 숫자 1자리 OCR 오인은 산술상 명확할 때만 교정합니다', () => {
    const r = parseSettlementReceiptOcrText(['메뉴 1개 18,000', '할인 -8,000', '결제금액 2,000원']);
    expect(r.totalWon).toBe(2000);
    expect(r.analysis.review_source.items[0]?.name).toContain('메뉴');
    expect(r.analysis.billing.total_amount).toBe(2000);
    expect(r.analysis.billing.is_verified).toBe(true);
  });
});
