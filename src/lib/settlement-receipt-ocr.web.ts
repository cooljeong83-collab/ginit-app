import type { SettlementReceiptOcrImageMeta, SettlementReceiptOcrRunResult } from '@/src/lib/settlement-receipt-ocr-types';

export async function runSettlementReceiptOcrFromUri(
  _uri: string,
  _imageMeta?: SettlementReceiptOcrImageMeta,
): Promise<SettlementReceiptOcrRunResult> {
  return { ok: false, message: '웹에서는 영수증 촬영 인식을 지원하지 않아요.' };
}
