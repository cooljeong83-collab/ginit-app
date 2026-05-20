import * as ImageManipulator from 'expo-image-manipulator';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { USER_REPORT_LOGIN_REQUIRED_MESSAGE } from '@/src/features/user-report/user-report-api';
import {
  storageSafeUserFolderSegment,
  uploadJpegBase64ToSupabasePublicBucket,
} from '@/src/lib/supabase-storage-upload';

/** `0196_user_report_submit.sql` */
export const SUPABASE_STORAGE_BUCKET_USER_REPORT_EVIDENCE = 'user_report_evidence';

const JPEG_MAX_WIDTH = 960;
const JPEG_QUALITY = 0.52;

function isRemoteImageUri(uri: string): boolean {
  const u = uri.trim().toLowerCase();
  return u.startsWith('https://') || u.startsWith('http://');
}

/**
 * 로컬 증빙 이미지를 JPEG로 줄여 Supabase 공개 버킷에 올리고 URL을 반환합니다.
 */
export async function uploadUserReportEvidenceImage(params: {
  reporterUserId: string;
  localImageUri: string;
  naturalWidth?: number;
}): Promise<string> {
  if (Platform.OS === 'web') {
    throw new Error('웹에서는 신고 첨부 이미지 업로드를 지원하지 않아요.');
  }
  const uid = storageSafeUserFolderSegment(params.reporterUserId);
  const uri = params.localImageUri.trim();
  if (!uid) throw new Error(USER_REPORT_LOGIN_REQUIRED_MESSAGE);
  if (!uri) throw new Error('이미지를 선택해 주세요.');
  if (isRemoteImageUri(uri)) {
    throw new Error('이미 업로드된 이미지입니다.');
  }

  const nw = params.naturalWidth;
  const actions: ImageManipulator.Action[] = [];
  if (typeof nw === 'number' && nw > 0 && nw > JPEG_MAX_WIDTH) {
    actions.push({ resize: { width: JPEG_MAX_WIDTH } });
  }

  const manipulated = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const base64 = await readAsStringAsync(manipulated.uri, { encoding: EncodingType.Base64 });
  if (!base64?.length) throw new Error('압축된 이미지를 읽지 못했습니다. 다시 선택해 주세요.');

  const rand = Math.random().toString(36).slice(2, 10);
  const objectPath = `reports/${uid}/${Date.now()}_${rand}.jpg`;
  return uploadJpegBase64ToSupabasePublicBucket(
    SUPABASE_STORAGE_BUCKET_USER_REPORT_EVIDENCE,
    objectPath,
    base64,
  );
}
