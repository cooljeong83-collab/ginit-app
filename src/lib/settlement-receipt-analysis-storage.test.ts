import { describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/hybrid-data-source', () => ({
  assertSupabasePublicReady: vi.fn(),
}));

vi.mock('@/src/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

import {
  buildSettlementReceiptAnalysisRpcPayload,
  fetchSettlementReceiptAnalysesFromSupabase,
} from '@/src/lib/settlement-receipt-analysis-storage';
import { supabase } from '@/src/lib/supabase';
import type { SettlementReceiptOcrAnalysis } from '@/src/lib/settlement-receipt-ocr-types';

const sampleAnalysis: SettlementReceiptOcrAnalysis = {
  verification: {
    biz_num: '123-45-67890',
    store_name: '지닛식당',
    datetime: '2026-05-11 20:30',
  },
  review_source: {
    items: [{ name: '치즈돈까스', tags: ['메인', '치즈'] }],
  },
  billing: {
    total_amount: 10000,
    is_verified: true,
  },
};

describe('buildSettlementReceiptAnalysisRpcPayload', () => {
  it('서버 RPC가 기대하는 snake_case payload로 변환합니다', () => {
    const payload = buildSettlementReceiptAnalysisRpcPayload([
      {
        receiptId: 'receipt-1',
        imageUrl: 'https://example.com/receipt.jpg',
        amountWon: 10000.8,
        analysis: sampleAnalysis,
      },
    ]);

    expect(payload).toEqual([
      {
        receipt_id: 'receipt-1',
        image_url: 'https://example.com/receipt.jpg',
        amount_won: 10000,
        analysis: sampleAnalysis,
      },
    ]);
  });

  it('중복 id, 로컬 uri, 비정상 금액은 제외합니다', () => {
    const payload = buildSettlementReceiptAnalysisRpcPayload([
      { receiptId: 'receipt-1', imageUrl: 'https://example.com/a.jpg', amountWon: 1000 },
      { receiptId: 'receipt-1', imageUrl: 'https://example.com/b.jpg', amountWon: 2000 },
      { receiptId: 'receipt-2', imageUrl: 'file:///local.jpg', amountWon: 3000 },
      { receiptId: 'receipt-3', imageUrl: 'https://example.com/c.jpg', amountWon: -1 },
    ]);

    expect(payload).toEqual([
      {
        receipt_id: 'receipt-1',
        image_url: 'https://example.com/a.jpg',
        amount_won: 1000,
        analysis: {},
      },
    ]);
  });
});

describe('fetchSettlementReceiptAnalysesFromSupabase', () => {
  it('읽기 RPC 결과를 화면 표시용 레코드로 변환합니다', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [
        {
          receipt_id: 'receipt-1',
          image_url: 'https://example.com/a.jpg',
          amount_won: 10000,
          analysis: sampleAnalysis,
          store_name: '지닛식당',
          biz_num: '123-45-67890',
          receipt_date_text: '2026-05-11 20:30',
          is_verified: true,
        },
      ],
      error: null,
    });

    const rows = await fetchSettlementReceiptAnalysesFromSupabase('meeting-1');

    expect(supabase.rpc).toHaveBeenCalledWith('get_settlement_receipt_analyses', {
      p_meeting_id: 'meeting-1',
    });
    expect(rows[0]).toMatchObject({
      receiptId: 'receipt-1',
      imageUrl: 'https://example.com/a.jpg',
      amountWon: 10000,
      storeName: '지닛식당',
      bizNum: '123-45-67890',
      receiptDateText: '2026-05-11 20:30',
      isVerified: true,
      analysis: sampleAnalysis,
    });
  });
});
