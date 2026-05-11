export type SettlementReceiptOcrImageMeta = {
  width?: number | null;
  height?: number | null;
};

export type SettlementReceiptOcrReviewSourceItem = {
  name: string;
  tags: string[];
};

export type SettlementReceiptOcrAnalysis = {
  verification: {
    biz_num: string | null;
    store_name: string | null;
    datetime: string | null;
  };
  review_source: {
    items: SettlementReceiptOcrReviewSourceItem[];
  };
  billing: {
    total_amount: number | null;
    is_verified: boolean;
  };
};

export type SettlementReceiptOcrProgress =
  | { phase: 'ocr_text'; chunks: string[] }
  | { phase: 'ai_analysis'; chunks: string[] };

export type SettlementReceiptOcrRunOptions = {
  onProgress?: (progress: SettlementReceiptOcrProgress) => void;
};

export type SettlementReceiptOcrRunResult =
  | {
      ok: true;
      totalWon: number | null;
      accountHint: string | null;
      rawChunkCount: number;
      analysis?: SettlementReceiptOcrAnalysis;
      analysisSource?: 'edge_ai' | 'local_parser';
    }
  | { ok: false; message: string; code?: 'not_receipt' };
