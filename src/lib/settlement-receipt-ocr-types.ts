export type SettlementReceiptOcrImageMeta = {
  width?: number | null;
  height?: number | null;
};

export type SettlementReceiptOcrRunResult =
  | { ok: true; totalWon: number | null; accountHint: string | null; rawChunkCount: number }
  | { ok: false; message: string };
