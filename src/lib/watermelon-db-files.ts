import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const MARKER_FILE = 'ginit_pending_watermelon_db_delete_v1';

function markerUri(): string | null {
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  return `${root}${MARKER_FILE}`;
}

/** 로그아웃 직후(프로세스 kill) — 다음 실행 시 Watermelon purge를 수행하도록 표시 */
export async function markWatermelonDatabaseDeletionOnNextLaunch(): Promise<void> {
  if (Platform.OS === 'web') return;
  const uri = markerUri();
  if (!uri) return;
  try {
    await FileSystem.writeAsStringAsync(uri, '1');
  } catch {
    /* ignore */
  }
}

/**
 * `exitApp` 로그아웃으로 미뤄 둔 Watermelon purge — 다음 앱 실행 시 열린 DB에서 SQL로 비웁니다.
 */
export async function applyDeferredWatermelonPurgeIfNeeded(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const uri = markerUri();
  if (!uri) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return false;
    if (__DEV__) console.log('[watermelon-db-files] deferred purge → SQL table wipe');
    const { purgeLocalUserScopedWatermelonOnSignOut } = await import('@/src/lib/watermelon-local-purge');
    await Promise.race([
      purgeLocalUserScopedWatermelonOnSignOut(),
      new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
    ]);
    await FileSystem.deleteAsync(uri, { idempotent: true });
    return true;
  } catch (e) {
    if (__DEV__) {
      console.warn(
        '[watermelon-db-files] deferred purge failed:',
        e instanceof Error ? e.message : e,
      );
    }
    return false;
  }
}
