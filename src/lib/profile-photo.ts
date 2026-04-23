import * as ImageManipulator from 'expo-image-manipulator';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { getDownloadURL, ref } from 'firebase/storage';

import { publicEnv } from '@/src/config/public-env';
import { ensureFirebaseAuthUserForStorage, getFirebaseAuth, getFirebaseStorage } from '@/src/lib/firebase';

const PROFILE_PHOTO_MAX_WIDTH = 768;
const PROFILE_PHOTO_JPEG_QUALITY = 0.72;

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function readStorageErrorDetail(res: Response, text: string): string {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const errJson = JSON.parse(text) as { error?: { message?: string } };
    if (errJson.error?.message) detail = errJson.error.message;
  } catch {
    if (text?.trim()) detail = text.trim().slice(0, 200);
  }
  return detail;
}

/**
 * RN 환경에서 Storage JS SDK가 blob/uint8array 업로드로 실패하는 케이스가 있어,
 * meeting-chat과 동일하게 resumable REST 업로드로 처리합니다.
 */
async function uploadJpegViaFirebaseStorageRest(objectPath: string, bytes: Uint8Array): Promise<void> {
  await ensureFirebaseAuthUserForStorage();
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error('인증 준비에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  const idToken = await user.getIdToken();
  const rawBucket = publicEnv.firebaseStorageBucket?.trim().replace(/^gs:\/\//, '') ?? '';
  if (!rawBucket) throw new Error('Storage 버킷(EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET)이 설정되어 있지 않습니다.');

  const bucketEnc = encodeURIComponent(rawBucket);
  const nameEnc = encodeURIComponent(objectPath);
  const startUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketEnc}/o?name=${nameEnc}`;

  const metaBody = JSON.stringify({
    name: objectPath,
    contentType: 'image/jpeg',
  });

  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': 'image/jpeg',
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: metaBody,
  });
  if (!startRes.ok) {
    const t = await startRes.text();
    throw new Error(`Storage 업로드 실패: ${readStorageErrorDetail(startRes, t)}`);
  }
  const uploadUrl =
    startRes.headers.get('x-goog-upload-url') ?? startRes.headers.get('X-Goog-Upload-URL') ?? '';
  if (!uploadUrl.trim()) throw new Error('Storage 업로드 URL을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');

  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.length),
    },
    body: bytes as unknown as BodyInit,
  });
  if (!upRes.ok) {
    const t = await upRes.text();
    throw new Error(`Storage 업로드 실패: ${readStorageErrorDetail(upRes, t)}`);
  }
}

export async function uploadProfilePhoto(params: {
  userId: string;
  localImageUri: string;
  naturalWidth?: number;
}): Promise<string> {
  const uid = params.userId.trim();
  const uri = params.localImageUri.trim();
  if (!uid) throw new Error('사용자 정보가 없습니다.');
  if (!uri) throw new Error('이미지를 선택해 주세요.');

  const actions: ImageManipulator.Action[] = [];
  if (typeof params.naturalWidth === 'number' && params.naturalWidth > PROFILE_PHOTO_MAX_WIDTH) {
    actions.push({ resize: { width: PROFILE_PHOTO_MAX_WIDTH } });
  }
  const manipulated = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: PROFILE_PHOTO_JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const base64 = await readAsStringAsync(manipulated.uri, { encoding: EncodingType.Base64 });
  if (!base64?.length) throw new Error('이미지를 읽지 못했습니다. 다시 선택해 주세요.');
  const bytes = base64ToUint8Array(base64);

  const rand = Math.random().toString(36).slice(2, 10);
  const objectPath = `users/${encodeURIComponent(uid)}/profile_${Date.now()}_${rand}.jpg`;
  const storageRef = ref(getFirebaseStorage(), objectPath);
  await uploadJpegViaFirebaseStorageRest(objectPath, bytes);
  return await getDownloadURL(storageRef);
}

