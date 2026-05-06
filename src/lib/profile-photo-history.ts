import { supabase } from '@/src/lib/supabase';
import { storageSafeUserFolderSegment, SUPABASE_STORAGE_BUCKET_AVATARS } from '@/src/lib/supabase-storage-upload';

export type ProfilePhotoHistoryItem = {
  photoUrl: string;
  createdAt: string;
};

const RPC_SCHEMA_CACHE_RETRY_WAITS_MS = [0, 800, 2500, 6000, 14000] as const;

/** Metro/Logcat: `[profile-photo-history:delete]` 필터. `EXPO_PUBLIC_GINIT_PROFILE_PHOTO_DELETE_DEBUG=1` 이면 __DEV__ 아닐 때도 출력 */
export function isProfilePhotoDeleteDebugEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  try {
    const v = process.env.EXPO_PUBLIC_GINIT_PROFILE_PHOTO_DELETE_DEBUG;
    return v === '1' || v === 'true' || v === 'yes';
  } catch {
    return false;
  }
}

export type DeleteProfilePhotoHistoryUrlResult =
  | { ok: true; storageRemoved: boolean }
  | { ok: false; skipped: true; reason: 'empty_id' | 'empty_url' }
  | { ok: false; message: string; code?: string; details?: string; hint?: string };

/** 공개 URL에서 `avatars` 객체 경로만 추출. 본인 폴더(`users/<segment>/`)일 때만 반환 */
export function avatarsObjectPathFromPublicUrlIfOwned(photoUrl: string, appUserId: string): string | null {
  const url = photoUrl.trim();
  const id = appUserId.trim();
  if (!url || !id) return null;
  const m = url.match(/\/storage\/v1\/object\/public\/avatars\/(.+?)(?:\?|#|$)/i);
  if (!m?.[1]) return null;
  let path = m[1].trim().replace(/^\/+|\/+$/g, '');
  if (!path || path.includes('..')) return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'users') return null;
  const seg = storageSafeUserFolderSegment(id);
  if (parts[1] !== seg) return null;
  return path;
}

function logDeleteDebug(kind: 'ok' | 'fail' | 'skip', payload: Record<string, unknown>): void {
  if (!isProfilePhotoDeleteDebugEnabled()) return;
  const line = `[profile-photo-history:delete] ${kind}`;
  if (kind === 'fail') {
    console.warn(line, payload);
  } else {
    console.log(line, payload);
  }
}

function isPostgrestSchemaCacheOrMissingRpcError(message: string, code?: string): boolean {
  const m = message.toLowerCase();
  if (m.includes('schema cache')) return true;
  if (m.includes('could not find the function')) return true;
  if (code === 'PGRST202' || code === '42883') return true;
  return false;
}

function parseJsonbHistory(data: unknown): ProfilePhotoHistoryItem[] {
  if (!Array.isArray(data)) return [];
  const out: ProfilePhotoHistoryItem[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const url = typeof r.photo_url === 'string' ? r.photo_url.trim() : typeof r.photoUrl === 'string' ? r.photoUrl.trim() : '';
    const createdAt =
      typeof r.created_at === 'string' ? r.created_at.trim() : typeof r.createdAt === 'string' ? r.createdAt.trim() : '';
    if (!url) continue;
    out.push({ photoUrl: url, createdAt: createdAt || new Date(0).toISOString() });
  }
  return out;
}

export async function fetchProfilePhotoHistory(appUserId: string, limit = 30): Promise<ProfilePhotoHistoryItem[]> {
  const id = appUserId.trim();
  if (!id) return [];

  let lastMessage = '';
  for (let i = 0; i < RPC_SCHEMA_CACHE_RETRY_WAITS_MS.length; i += 1) {
    const wait = RPC_SCHEMA_CACHE_RETRY_WAITS_MS[i]!;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const { data, error } = await supabase.rpc('list_profile_photo_history', {
      p_app_user_id: id,
      p_limit: Math.max(1, Math.min(60, Math.trunc(limit))),
    });
    if (!error) return parseJsonbHistory(data);
    const msg = error.message?.trim() || 'list_profile_photo_history failed';
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
    lastMessage = msg;
    if (!isPostgrestSchemaCacheOrMissingRpcError(msg, code)) break;
  }

  // 사진 히스토리는 UX 보조 정보라, 실패 시 빈 목록으로 폴백합니다.
  void lastMessage;
  return [];
}

export async function deleteProfilePhotoHistoryUrl(
  appUserId: string,
  photoUrl: string,
): Promise<DeleteProfilePhotoHistoryUrlResult> {
  const id = appUserId.trim();
  const url = photoUrl.trim();
  if (!id) {
    logDeleteDebug('skip', { reason: 'empty_id' });
    return { ok: false, skipped: true, reason: 'empty_id' };
  }
  if (!url) {
    logDeleteDebug('skip', { reason: 'empty_url', appUserIdLen: id.length });
    return { ok: false, skipped: true, reason: 'empty_url' };
  }

  const { error } = await supabase.rpc('delete_profile_photo_history_url', {
    p_app_user_id: id,
    p_photo_url: url,
  });

  if (error) {
    const err = error as {
      message?: string;
      code?: string;
      details?: string;
      hint?: string;
    };
    logDeleteDebug('fail', {
      phase: 'rpc',
      appUserId: id,
      photoUrlPreview: url.length > 96 ? `${url.slice(0, 96)}…` : url,
      message: err.message ?? 'unknown',
      code: err.code,
      details: err.details,
      hint: err.hint,
    });
    return {
      ok: false,
      message: (err.message ?? 'delete_profile_photo_history_url failed').trim(),
      code: typeof err.code === 'string' ? err.code : undefined,
      details: typeof err.details === 'string' ? err.details : undefined,
      hint: typeof err.hint === 'string' ? err.hint : undefined,
    };
  }

  const objectPath = avatarsObjectPathFromPublicUrlIfOwned(url, id);
  let storageRemoved = false;
  if (objectPath) {
    const { error: rmErr } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET_AVATARS).remove([objectPath]);
    if (rmErr) {
      logDeleteDebug('fail', {
        phase: 'storage',
        appUserId: id,
        objectPath,
        message: rmErr.message ?? 'storage.remove failed',
      });
    } else {
      storageRemoved = true;
    }
  }

  logDeleteDebug('ok', {
    appUserId: id,
    photoUrlPreview: url.length > 96 ? `${url.slice(0, 96)}…` : url,
    storageRemoved,
    hadParsedPath: Boolean(objectPath),
  });
  return { ok: true, storageRemoved };
}

