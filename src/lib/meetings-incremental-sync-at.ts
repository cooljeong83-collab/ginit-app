import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ginit_last_meetings_incremental_sync_success_at_ms';

/** 메모리(빠른 경로) + AsyncStorage(재실행 복구) */
let lastSuccessAtMsMem = 0;

export async function hydrateMeetingsIncrementalSyncAtFromStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    if (Number.isFinite(n) && n > lastSuccessAtMsMem) lastSuccessAtMsMem = n;
  } catch {
    /* ignore */
  }
}

/** 푸시·포그라운드 증분 동기화 등 “목록이 서버와 맞춰진 시점” 기록 */
export async function markMeetingsIncrementalSyncSuccess(nowMs: number = Date.now()): Promise<void> {
  lastSuccessAtMsMem = nowMs;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, String(nowMs));
  } catch {
    /* ignore */
  }
}

/**
 * 마지막 성공 시각 기준 최소 간격이 지났는지.
 * 호출 전에 `hydrateMeetingsIncrementalSyncAtFromStorage`를 한 번 이상 부르는 것을 권장합니다.
 */
export async function canRunMeetingsIncrementalSyncAfterGap(minGapMs: number): Promise<boolean> {
  await hydrateMeetingsIncrementalSyncAtFromStorage();
  return Date.now() - lastSuccessAtMsMem >= minGapMs;
}
