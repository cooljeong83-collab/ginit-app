import { publicEnv } from '@/src/config/public-env';
import { supabase } from '@/src/lib/supabase';

/** `0005_profile_avatars_storage.sql` */
export const SUPABASE_STORAGE_BUCKET_AVATARS = 'avatars';

/** `0021_meeting_chat_storage.sql` */
export const SUPABASE_STORAGE_BUCKET_MEETING_CHAT = 'meeting_chat';

function assertSupabaseStorageReady(): void {
  if (!publicEnv.supabaseUrl?.trim() || !publicEnv.supabaseAnonKey?.trim()) {
    throw new Error(
      'Supabase Storage를 쓰려면 EXPO_PUBLIC_SUPABASE_URL·EXPO_PUBLIC_SUPABASE_ANON_KEY가 필요합니다.',
    );
  }
}

function base64ToUint8Array(b64: string): Uint8Array {
  const clean = b64.replace(/\s/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Storage 경로 세그먼트에 `/` 등이 들어가면 깨지므로 안전한 한 덩어리로 만듭니다. */
export function storageSafeUserFolderSegment(userId: string): string {
  return userId.trim().replace(/\//g, '_');
}

/**
 * 공개 버킷에 JPEG를 올리고 **공개 URL**을 반환합니다.
 * (`avatars`·`meeting_chat` 등 migration에서 `public = true`인 버킷)
 */
export async function uploadJpegToSupabasePublicBucket(
  bucket: string,
  objectPath: string,
  jpegBytes: Uint8Array,
): Promise<string> {
  assertSupabaseStorageReady();
  const path = objectPath.replace(/^\/+/, '');
  if (!path) throw new Error('저장 경로가 비어 있습니다.');

  const { error } = await supabase.storage.from(bucket).upload(path, jpegBytes, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) {
    throw new Error(error.message || 'Supabase Storage 업로드에 실패했습니다.');
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  const url = data.publicUrl?.trim();
  if (!url) throw new Error('공개 URL을 만들지 못했습니다.');
  return url;
}

export async function uploadJpegBase64ToSupabasePublicBucket(
  bucket: string,
  objectPath: string,
  base64: string,
): Promise<string> {
  const b64 = base64.replace(/\s/g, '');
  if (!b64.length) throw new Error('이미지 데이터가 비어 있습니다.');
  const bytes = base64ToUint8Array(b64);
  return uploadJpegToSupabasePublicBucket(bucket, objectPath, bytes);
}
