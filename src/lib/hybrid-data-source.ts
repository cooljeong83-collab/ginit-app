import { publicEnv } from '@/src/config/public-env';

function supabasePublicReady(): boolean {
  return Boolean(publicEnv.supabaseUrl?.trim() && publicEnv.supabaseAnonKey?.trim());
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

/** 프로필 읽기: Ledger 시 `supabase` 고정, 아니면 `EXPO_PUBLIC_PROFILE_SOURCE` + RPC `0007` */
export function profilesSource(): 'firestore' | 'supabase' {
  if (ledgerWritesToSupabase()) return 'supabase';
  const v = (publicEnv.profilesSource ?? '').trim().toLowerCase();
  if (v === 'supabase' && supabasePublicReady()) return 'supabase';
  return 'firestore';
}
