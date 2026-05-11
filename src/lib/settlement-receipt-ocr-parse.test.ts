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
});
