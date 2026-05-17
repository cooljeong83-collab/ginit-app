import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'feed_category_bar_visible_ids_v1';
const EXPLORE_TODAY_ONLY_KEY = 'feed_explore_today_only_v1';

/**
 * 모임 탭(피드) 카테고리 드롭다운에 나올 카테고리 id 목록.
 * `null`이면 마스터 전부 표시(기본).
 */
export async function loadFeedCategoryBarVisibleIds(): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw == null || raw.trim() === '') return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.map((x) => String(x ?? '').trim()).filter(Boolean);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

/** `null` 또는 빈 배열 저장 시 → 전체 표시로 초기화(키 제거). */
export async function persistFeedCategoryBarVisibleIds(ids: string[] | null): Promise<void> {
  try {
    if (ids == null || ids.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* 저장 실패는 기본(전체) 유지 */
  }
}

/** 모임·지도 탐색 — 서울 기준 오늘 일정 모임만 표시 */
export async function loadFeedExploreTodayOnly(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(EXPLORE_TODAY_ONLY_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export async function persistFeedExploreTodayOnly(enabled: boolean): Promise<void> {
  try {
    if (!enabled) {
      await AsyncStorage.removeItem(EXPLORE_TODAY_ONLY_KEY);
      return;
    }
    await AsyncStorage.setItem(EXPLORE_TODAY_ONLY_KEY, '1');
  } catch {
    /* ignore */
  }
}
