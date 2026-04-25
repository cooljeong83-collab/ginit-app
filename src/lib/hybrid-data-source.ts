import { publicEnv } from '@/src/config/public-env';

function supabasePublicReady(): boolean {
  return Boolean(publicEnv.supabaseUrl?.trim() && publicEnv.supabaseAnonKey?.trim());
}

export function assertSupabasePublicReady(): void {
  if (supabasePublicReady()) return;
  throw new Error('[supabase] EXPO_PUBLIC_SUPABASE_URL/EXPO_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않았습니다.');
}

/**
 * 모임·프로필 비실시간 데이터를 Supabase에 기록합니다.
 * 끄려면 `EXPO_PUBLIC_LEDGER_WRITES=firestore` (Supabase URL·Anon이 있어도 Firestore만 사용).
 */
export function ledgerWritesToSupabase(): boolean {
  if (!supabasePublicReady()) return false;
  const raw = (publicEnv as { ledgerWrites?: string }).ledgerWrites ?? '';
  const v = raw.trim().toLowerCase();
  if (v === 'firestore') return false;
  return true;
}

/** 피드 모임 목록: Ledger 켜짐 시 기본 `supabase`, 아니면 env */
export function meetingListSource(): 'firestore' | 'supabase' {
  if (ledgerWritesToSupabase()) return 'supabase';
  const v = (publicEnv.meetingListSource ?? '').trim().toLowerCase();
  if (v === 'supabase' && supabasePublicReady()) return 'supabase';
  return 'firestore';
}

/**
 * 카테고리 마스터: 기본은 Supabase(`meeting_categories`) — URL·Anon 키가 있을 때.
 * Firestore만 쓰려면 `EXPO_PUBLIC_CATEGORIES_SOURCE=firestore`.
 */
export function categoriesSource(): 'firestore' | 'supabase' {
  const v = (publicEnv.categoriesSource ?? '').trim().toLowerCase();
  if (v === 'firestore') return 'firestore';
  if (!supabasePublicReady()) return 'firestore';
  return 'supabase';
}

/**
 * 프로필 읽기·`ensureUserProfile` 경로.
 * - `EXPO_PUBLIC_PROFILE_SOURCE=firestore` → Ledger(Supabase)와 무관하게 Firestore `users` 사용.
 *   (`ensure_profile_minimal` RPC가 프로젝트에 없거나 PostgREST 캐시에 안 잡힐 때 임시 우회)
 * - `EXPO_PUBLIC_PROFILE_SOURCE=supabase` + Supabase 준비됨 → 항상 RPC
 * - 그 외: Ledger 켜지면 supabase, 아니면 firestore
 */
export function profilesSource(): 'firestore' | 'supabase' {
  // 프로필은 Supabase 단일 소스 오브 트루스.
  assertSupabasePublicReady();
  return 'supabase';
}
