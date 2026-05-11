import { extractTextFromImage, isSupported } from 'expo-text-extractor';

import { parseSettlementReceiptOcrText } from '@/src/lib/settlement-receipt-ocr-parse';
import { prepareReceiptImageForOcr } from '@/src/lib/settlement-receipt-ocr-prepare';
import type {
  SettlementReceiptOcrImageMeta,
  SettlementReceiptOcrRunResult,
} from '@/src/lib/settlement-receipt-ocr-types';

export async function runSettlementReceiptOcrFromUri(
  uri: string,
  imageMeta?: SettlementReceiptOcrImageMeta,
): Promise<SettlementReceiptOcrRunResult> {
  const u = uri.trim();
  if (!u) return { ok: false, message: '이미지가 없어요.' };
  if (!isSupported) {
    return { ok: false, message: '이 기기에서 텍스트 인식을 사용할 수 없어요.' };
  }
  try {
    let ocrUri = u;
    try {
      ocrUri = await prepareReceiptImageForOcr(u, imageMeta);
    } catch {
      ocrUri = u;
    }
    let chunks = await extractTextFromImage(ocrUri);
    const joinedLen = chunks.join('\n').trim().length;
    if (joinedLen < 40 && ocrUri !== u) {
      try {
        const extra = await extractTextFromImage(u);
        chunks = [...chunks, ...extra];
      } catch {
        /* 원본 재시도 실패 시 준비본 결과만 사용 */
      }
    }
    const { totalWon, accountHint } = parseSettlementReceiptOcrText(chunks);
    return { ok: true, totalWon, accountHint, rawChunkCount: chunks.length };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '영수증 인식에 실패했어요.' };
  }
}
