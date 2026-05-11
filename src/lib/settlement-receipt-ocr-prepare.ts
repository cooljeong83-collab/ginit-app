/**
 * 채팅 이미지 전송(`meeting-chat`)과 같이 업로드 전 리사이즈·JPEG 재압축으로
 * ML Kit / Vision OCR이 읽기 좋은 해상도·대비를 맞춥니다.
 */
import * as ImageManipulator from 'expo-image-manipulator';

import type { SettlementReceiptOcrImageMeta } from '@/src/lib/settlement-receipt-ocr-types';

/** 가로가 긴 영수증 — 너무 크면 노이즈·왜곡이 늘고 OCR이 흔들립니다 */
const RECEIPT_OCR_MAX_WIDTH = 1680;
/** 세로가 매우 긴 전표(페이·카페 등) */
const RECEIPT_OCR_MAX_HEIGHT = 2800;
const RECEIPT_OCR_JPEG_QUALITY = 0.9;

export async function prepareReceiptImageForOcr(uri: string, meta?: SettlementReceiptOcrImageMeta): Promise<string> {
  const w = typeof meta?.width === 'number' && Number.isFinite(meta.width) ? meta.width : 0;
  const h = typeof meta?.height === 'number' && Number.isFinite(meta.height) ? meta.height : 0;

  const actions: ImageManipulator.Action[] = [];
  if (w > RECEIPT_OCR_MAX_WIDTH) {
    actions.push({ resize: { width: RECEIPT_OCR_MAX_WIDTH } });
  } else if (h > RECEIPT_OCR_MAX_HEIGHT) {
    actions.push({ resize: { height: RECEIPT_OCR_MAX_HEIGHT } });
  }

  const out = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: RECEIPT_OCR_JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return out.uri;
}
