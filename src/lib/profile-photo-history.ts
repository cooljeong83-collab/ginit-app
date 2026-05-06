import { supabase } from '@/src/lib/supabase';

export type ProfilePhotoHistoryItem = {
  photoUrl: string;
  createdAt: string;
};

const RPC_SCHEMA_CACHE_RETRY_WAITS_MS = [0, 800, 2500, 6000, 14000] as const;

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

