import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/hybrid-data-source', () => ({
  assertSupabasePublicReady: vi.fn(),
}));

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@/src/lib/supabase', () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

import {
  analyzeSettlementReceiptOcrTextWithAi,
  normalizeSettlementReceiptAiResponse,
} from '@/src/lib/settlement-receipt-ai-client';

const analysis = {
  verification: {
    biz_num: '123-45-67890',
    store_name: '지닛식당',
    datetime: '2026-05-11 20:30',
  },
  review_source: {
    items: [{ name: '치즈돈까스', tags: ['메인', '치즈'] }],
  },
  billing: {
    total_amount: 8000,
    is_verified: true,
  },
};

describe('normalizeSettlementReceiptAiResponse', () => {
  it('Edge AI 응답을 앱 분석 타입으로 정규화합니다', () => {
    const r = normalizeSettlementReceiptAiResponse({
      ok: true,
      analysis,
      totalWon: '8,000',
      accountHint: '국민 123',
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalWon).toBe(8000);
    expect(r.accountHint).toBe('국민 123');
    expect(r.analysis.verification.biz_num).toBe('123-45-67890');
    expect(r.analysis.billing.is_verified).toBe(true);
    expect(r.analysis.review_source.items[0]?.tags).toEqual(['메인', '치즈']);
  });

  it('분석 금액이 없으면 실패로 처리합니다', () => {
    const r = normalizeSettlementReceiptAiResponse({ ok: true, analysis: { billing: {} } });
    expect(r.ok).toBe(false);
  });
});

describe('analyzeSettlementReceiptOcrTextWithAi', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('OCR chunks를 영수증 Edge Function으로 보냅니다', async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: true, analysis, totalWon: 8000 }, error: null });

    const r = await analyzeSettlementReceiptOcrTextWithAi(['지닛식당', '결제금액 8,000원']);

    expect(invokeMock).toHaveBeenCalledWith('analyze-settlement-receipt', {
      body: {
        chunks: ['지닛식당', '결제금액 8,000원'],
        rawText: '지닛식당\n결제금액 8,000원',
        locale: 'ko-KR',
        currency: 'KRW',
      },
    });
    expect(r.ok).toBe(true);
  });

  it('Edge 호출 실패 메시지를 반환합니다', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: 'Function failed' } });

    const r = await analyzeSettlementReceiptOcrTextWithAi(['결제금액 8,000원']);

    expect(r).toEqual({ ok: false, message: 'Function failed' });
  });
});
