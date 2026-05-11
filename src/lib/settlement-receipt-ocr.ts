/**
 * Metro가 `settlement-receipt-ocr.native.ts` / `settlement-receipt-ocr.web.ts`를 선택합니다.
 * TypeScript는 이 파일을 통해 동일 시그니처를 인식합니다.
 */
export type { SettlementReceiptOcrImageMeta, SettlementReceiptOcrRunResult } from '@/src/lib/settlement-receipt-ocr-types';
export { runSettlementReceiptOcrFromUri } from '@/src/lib/settlement-receipt-ocr.web';
export { parseSettlementReceiptOcrText } from '@/src/lib/settlement-receipt-ocr-parse';
