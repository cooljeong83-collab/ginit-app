import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/src/lib/supabase';

const STORAGE_PREFIX = '@ginit/dau_recorded_v1/';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function storageKey(appUserId: string): string {
  return `${STORAGE_PREFIX}${todayKey()}/${appUserId.trim().toLowerCase()}`;
}

/**
 * 앱을 켠 경우(포그라운드 진입) 일별 활성 사용자 1회 집계.
 * 로그인 버튼·세션 게이트와 분리 — RPC dedup + 로컬 캐시로 당일 중복 호출 최소화.
 */
export async function recordAppActiveUser(appUserId: string): Promise<void> {
  const id = appUserId.trim();
  if (!id) return;

  try {
    const cached = await AsyncStorage.getItem(storageKey(id));
    if (cached === '1') return;
  } catch {
    /* 캐시 실패 시 RPC만 시도 */
  }

  const { error } = await supabase.rpc('record_daily_active_user', {
    p_app_user_id: id,
  });

  if (error) {
    console.warn('[recordAppActiveUser]', error.message);
    return;
  }

  try {
    await AsyncStorage.setItem(storageKey(id), '1');
  } catch {
    /* 집계는 완료됨 */
  }
}
