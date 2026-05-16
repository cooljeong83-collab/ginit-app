import { publicEnv } from '@/src/config/public-env';

function supabasePublicReady(): boolean {
  return Boolean(publicEnv.supabaseUrl?.trim() && publicEnv.supabaseAnonKey?.trim());
}

export function assertSupabasePublicReady(): void {
  if (supabasePublicReady()) return;
  throw new Error('[supabase] EXPO_PUBLIC_SUPABASE_URL/EXPO_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않았습니다.');
}

/**
 * 모임 원장(생성·수정·삭제·채팅 읽음 병합 등) 쓰기 경로.
 * **진실의 원천은 Supabase**이며, 공개 URL·Anon 키가 있으면 항상 Ledger RPC·`meetings` 행만 갱신합니다.
 */
export function ledgerWritesToSupabase(): boolean {
  return supabasePublicReady();
}

/**
 * 채팅 메시지 델타는 Supabase 단일 경로(`chat_pull_deltas` / `chat_send_message` 등, 마이그레이션 0135+).
 */
export function chatDeltaTransport(): 'supabase' {
  return 'supabase';
}

/**
 * 프로필 읽기·`ensureUserProfile` 경로 — Supabase 단일 소스.
 */
export function profilesSource(): 'supabase' {
  assertSupabasePublicReady();
  return 'supabase';
}
