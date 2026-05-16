import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { Meeting } from '@/src/lib/meetings';
import { fetchMyMeetingsForFeedFromSupabase, fetchPublicMeetingsFromSupabaseOnce, subscribeMeetingsFromSupabase } from '@/src/lib/supabase-meetings-list';

/**
 * 피드·지도·채팅 등 — 공개 모임 전체는 Pull 기본(`subscribeMeetingsFromSupabase`).
 * (과거 옵션으로 붙이던 행 단위 Postgres Realtime은 제거됨 — 홈 피드는 무한 스크롤·증분 reconcile 경로 사용)
 */
export function subscribeMeetingsHybrid(
  onData: (meetings: Meeting[]) => void,
  onError?: (message: string) => void,
): () => void {
  return subscribeMeetingsFromSupabase(onData, onError);
}

/** 공개 모임 일회 조회(당겨서 새로고침 등). */
export async function fetchMeetingsOnceHybrid(): Promise<
  { ok: true; meetings: Meeting[] } | { ok: false; message: string }
> {
  return fetchPublicMeetingsFromSupabaseOnce();
}

/**
 * 회원 탈퇴 등 — 내가 참여·주최한 모임만 필요합니다.
 * Supabase 경로에서는 `ledger_list_my_meetings_for_feed` RPC를 사용합니다.
 */
export async function fetchMeetingsForAccountDeletionHybrid(
  appUserId: string,
): Promise<{ ok: true; meetings: Meeting[] } | { ok: false; message: string }> {
  const raw = typeof appUserId === 'string' ? appUserId.trim() : '';
  if (!raw) return { ok: false, message: '로그인 정보가 없습니다.' };
  const ns = normalizeParticipantId(raw) || raw;
  return fetchMyMeetingsForFeedFromSupabase(ns);
}
