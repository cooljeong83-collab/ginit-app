import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { supabase } from '@/src/lib/supabase';

const PROFILE_ROW_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSupabaseProfileRowUuid(v: string | null | undefined): boolean {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 && PROFILE_ROW_UUID_RE.test(s);
}

/**
 * `profiles.id`(행 UUID) — Realtime `user_notifications:{id}` 등에 사용.
 * `get_profile_public_by_app_user_id` 응답의 `id` 필드를 사용합니다.
 */
export async function fetchSupabaseProfileRowIdByAppUserId(appUserId: string): Promise<string | null> {
  const uid = normalizeParticipantId(appUserId);
  if (!uid) return null;
  const { data, error } = await supabase.rpc('get_profile_public_by_app_user_id', {
    p_app_user_id: uid,
  });
  if (error || data == null || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : row.id != null ? String(row.id).trim() : '';
  if (!isSupabaseProfileRowUuid(id)) return null;
  /** Realtime 토픽·0154 RLS와 동일하게 소문자 UUID로 통일 */
  return id.toLowerCase();
}
