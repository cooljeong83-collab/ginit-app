import * as ImageManipulator from 'expo-image-manipulator';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import {
  SUPABASE_STORAGE_BUCKET_MEETING_CHAT,
  SUPABASE_STORAGE_BUCKET_SETTLEMENT_RECEIPTS,
  uploadJpegBase64ToSupabasePublicBucket,
} from '@/src/lib/supabase-storage-upload';

function isSettlementReceiptBucketMissingError(message: string): boolean {
  const m = message.trim().toLowerCase();
  return m.includes('bucket not found') || m.includes('unknown bucket');
}

/** 정산 영수증 썸네일용(가독·용량 균형) */
const SETTLEMENT_RECEIPT_JPEG_MAX_WIDTH = 960;
const SETTLEMENT_RECEIPT_JPEG_QUALITY = 0.52;

export function isRemoteSettlementReceiptImageUri(uri: string): boolean {
  const u = uri.trim().toLowerCase();
  return u.startsWith('https://') || u.startsWith('http://');
}

/**
 * 로컬 영수증 이미지를 JPEG로 줄여 Supabase 공개 버킷에 올리고 URL을 반환합니다.
 * (웹·시뮬레이터 등 파일 URI가 없는 환경에서는 호출하지 마세요.)
 */
export async function uploadCompressedSettlementReceiptToSupabase(params: {
  meetingId: string;
  uploaderUserId: string;
  localImageUri: string;
  naturalWidth?: number;
}): Promise<string> {
  if (Platform.OS === 'web') {
    throw new Error('웹에서는 영수증 파일 업로드를 지원하지 않아요.');
  }
  const mid = params.meetingId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
  const uid = params.uploaderUserId.trim();
  const uri = params.localImageUri.trim();
  if (!mid) throw new Error('모임 정보가 없습니다.');
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!uri) throw new Error('이미지를 선택해 주세요.');
  if (isRemoteSettlementReceiptImageUri(uri)) {
    throw new Error('이미 업로드된 영수증입니다.');
  }

  const nw = params.naturalWidth;
  const actions: ImageManipulator.Action[] = [];
  if (typeof nw === 'number' && nw > 0 && nw > SETTLEMENT_RECEIPT_JPEG_MAX_WIDTH) {
    actions.push({ resize: { width: SETTLEMENT_RECEIPT_JPEG_MAX_WIDTH } });
  }

  const manipulated = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: SETTLEMENT_RECEIPT_JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const base64 = await readAsStringAsync(manipulated.uri, { encoding: EncodingType.Base64 });
  if (!base64?.length) throw new Error('압축된 이미지를 읽지 못했습니다. 다시 선택해 주세요.');

  const rand = Math.random().toString(36).slice(2, 10);
  const objectPath = `meetings/${mid}/receipts/${Date.now()}_${rand}.jpg`;
  try {
    return await uploadJpegBase64ToSupabasePublicBucket(SUPABASE_STORAGE_BUCKET_SETTLEMENT_RECEIPTS, objectPath, base64);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isSettlementReceiptBucketMissingError(msg)) throw e;
    const fallbackPath = `settlement_receipts/${objectPath}`;
    return uploadJpegBase64ToSupabasePublicBucket(SUPABASE_STORAGE_BUCKET_MEETING_CHAT, fallbackPath, base64);
  }
}
