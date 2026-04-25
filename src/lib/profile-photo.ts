import * as ImageManipulator from 'expo-image-manipulator';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';

import {
  storageSafeUserFolderSegment,
  SUPABASE_STORAGE_BUCKET_AVATARS,
  uploadJpegBase64ToSupabasePublicBucket,
} from '@/src/lib/supabase-storage-upload';

const PROFILE_PHOTO_MAX_WIDTH = 768;
const PROFILE_PHOTO_JPEG_QUALITY = 0.72;

export async function uploadProfilePhoto(params: {
  userId: string;
  localImageUri: string;
  naturalWidth?: number;
  /** 있으면 가로·세로가 다를 때 중앙 정사각형 크롭 후 업로드(네이티브 크롭 UI 없이 동일 효과) */
  naturalHeight?: number;
}): Promise<string> {
  const uid = params.userId.trim();
  const uri = params.localImageUri.trim();
  if (!uid) throw new Error('사용자 정보가 없습니다.');
  if (!uri) throw new Error('이미지를 선택해 주세요.');

  const nw = params.naturalWidth;
  const nh = params.naturalHeight;
  const actions: ImageManipulator.Action[] = [];
  if (typeof nw === 'number' && typeof nh === 'number' && nw > 0 && nh > 0 && nw !== nh) {
    const side = Math.min(nw, nh);
    const originX = Math.max(0, Math.floor((nw - side) / 2));
    const originY = Math.max(0, Math.floor((nh - side) / 2));
    actions.push({ crop: { originX, originY, width: side, height: side } });
  }
  const widthAfterCrop =
    typeof nw === 'number' && typeof nh === 'number' && nw > 0 && nh > 0
      ? Math.min(nw, nh)
      : typeof nw === 'number' && nw > 0
        ? nw
        : undefined;
  if (typeof widthAfterCrop === 'number' && widthAfterCrop > PROFILE_PHOTO_MAX_WIDTH) {
    actions.push({ resize: { width: PROFILE_PHOTO_MAX_WIDTH } });
  } else if (
    widthAfterCrop === undefined &&
    typeof params.naturalWidth === 'number' &&
    params.naturalWidth > PROFILE_PHOTO_MAX_WIDTH
  ) {
    actions.push({ resize: { width: PROFILE_PHOTO_MAX_WIDTH } });
  }
  const manipulated = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: PROFILE_PHOTO_JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const base64 = await readAsStringAsync(manipulated.uri, { encoding: EncodingType.Base64 });
  if (!base64?.length) throw new Error('이미지를 읽지 못했습니다. 다시 선택해 주세요.');

  const rand = Math.random().toString(36).slice(2, 10);
  const folder = storageSafeUserFolderSegment(uid);
  const objectPath = `users/${folder}/profile_${Date.now()}_${rand}.jpg`;
  return uploadJpegBase64ToSupabasePublicBucket(SUPABASE_STORAGE_BUCKET_AVATARS, objectPath, base64);
}
