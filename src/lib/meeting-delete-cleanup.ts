import { supabase } from '@/src/lib/supabase';
import {
  SUPABASE_STORAGE_BUCKET_MEETING_CHAT,
  SUPABASE_STORAGE_BUCKET_SETTLEMENT_RECEIPTS,
} from '@/src/lib/supabase-storage-upload';

function sanitizeMeetingIdForStorage(meetingId: string): string {
  return meetingId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
}

function supabasePublicObjectPathFromUrl(url: string, bucket: string): string | null {
  const u = url.trim();
  if (!u) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = u.indexOf(marker);
  if (idx < 0) return null;
  const tail = u.slice(idx + marker.length).split('?')[0]?.split('#')[0]?.trim();
  return tail || null;
}

async function listStorageObjectPaths(bucketName: string, prefix: string): Promise<string[]> {
  const bucket = supabase.storage.from(bucketName);
  const paths: string[] = [];
  const pageSize = 200;
  let offset = 0;
  for (;;) {
    const { data, error } = await bucket.list(prefix, { limit: pageSize, offset });
    if (error || !data?.length) break;
    for (const f of data) {
      const name = typeof f.name === 'string' ? f.name.trim() : '';
      if (!name) continue;
      const id = (f as { id?: string | null }).id;
      if (id === null) {
        const nested = await listStorageObjectPaths(bucketName, `${prefix}/${name}`);
        paths.push(...nested);
        continue;
      }
      paths.push(`${prefix}/${name}`);
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return paths;
}

async function removeStoragePathsBestEffort(bucketName: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const bucket = supabase.storage.from(bucketName);
  const batch = 100;
  for (let i = 0; i < paths.length; i += batch) {
    await bucket.remove(paths.slice(i, i + batch)).catch(() => {});
  }
}

async function removeStoragePrefixBestEffort(bucketName: string, prefix: string): Promise<void> {
  const p = prefix.trim().replace(/\/+$/, '');
  if (!p) return;
  try {
    const paths = await listStorageObjectPaths(bucketName, p);
    await removeStoragePathsBestEffort(bucketName, paths);
  } catch {
    /* 목록·삭제 불가 시 생략 */
  }
}

async function removeMeetingStorageUrlBestEffort(imageUrl: string | null | undefined): Promise<void> {
  const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (!url) return;
  for (const bucket of [SUPABASE_STORAGE_BUCKET_MEETING_CHAT, SUPABASE_STORAGE_BUCKET_SETTLEMENT_RECEIPTS] as const) {
    const path = supabasePublicObjectPathFromUrl(url, bucket);
    if (!path) continue;
    await supabase.storage.from(bucket).remove([path]).catch(() => {});
  }
}

/**
 * 모임 삭제·자동 파기 전후 Storage 정리(채팅 이미지·정산 영수증·모임 커버 URL).
 * 실패는 삼키고 호출부 UX를 유지합니다.
 */
export async function purgeMeetingStorageBestEffort(params: {
  routeMeetingId: string;
  ledgerMeetingId?: string | null;
  imageUrl?: string | null;
}): Promise<void> {
  const routeId = params.routeMeetingId.trim();
  const ledgerId = params.ledgerMeetingId?.trim() || routeId;
  const storageIds = Array.from(
    new Set(
      [routeId, ledgerId]
        .map((x) => sanitizeMeetingIdForStorage(x))
        .filter((x) => x.length > 0),
    ),
  );
  if (storageIds.length === 0 && !params.imageUrl?.trim()) return;

  await removeMeetingStorageUrlBestEffort(params.imageUrl);

  for (const sid of storageIds) {
    const meetingPrefix = `meetings/${sid}`;
    await Promise.all([
      removeStoragePrefixBestEffort(SUPABASE_STORAGE_BUCKET_MEETING_CHAT, meetingPrefix),
      removeStoragePrefixBestEffort(SUPABASE_STORAGE_BUCKET_SETTLEMENT_RECEIPTS, `${meetingPrefix}/receipts`),
      removeStoragePrefixBestEffort(
        SUPABASE_STORAGE_BUCKET_MEETING_CHAT,
        `settlement_receipts/${meetingPrefix}`,
      ),
    ]);
  }
}
