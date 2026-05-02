import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'map_category_bar_visible_ids_v1';

/**
 * 지도 탭 상단 칩에 표시할 카테고리 id 목록.
 * `null`이면 마스터 전체를 표시(기본).
 */
export async function loadMapCategoryBarVisibleIds(): Promise<string[] | null> {
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
export async function persistMapCategoryBarVisibleIds(ids: string[] | null): Promise<void> {
  try {
    if (ids == null || ids.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* 저장 실패는 칩만 기본으로 유지 */
  }
}
