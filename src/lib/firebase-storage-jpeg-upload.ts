import { ref, uploadBytes } from 'firebase/storage';

import { ensureFirebaseAuthUserForStorage, getFirebaseStorage } from '@/src/lib/firebase';

/**
 * Firebase Storage에 JPEG 바이트를 올립니다.
 * (구) RN에서 `uploadBytes`가 Blob 이슈로 실패한다는 우려가 있었으나, `Uint8Array` + `uploadBytes`는
 * 현행 Firebase/Expo에서 권장 경로이며, 잘못된 REST `POST` 업로드로 인한 404를 피합니다.
 */
export async function uploadJpegBytesToFirebaseStorage(objectPath: string, bytes: Uint8Array): Promise<void> {
  await ensureFirebaseAuthUserForStorage();
  const storageRef = ref(getFirebaseStorage(), objectPath);
  await uploadBytes(storageRef, bytes, { contentType: 'image/jpeg' });
}

/** Storage 경로 세그먼트에 `/` 등이 들어가면 깨지므로 안전한 한 덩어리로 만듭니다. */
export function storageSafeUserFolderSegment(userId: string): string {
  return userId.trim().replace(/\//g, '_');
}
