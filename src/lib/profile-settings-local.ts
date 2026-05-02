import AsyncStorage from '@react-native-async-storage/async-storage';

const DND_QUIET_HOURS_KEY = 'ginit_profile_dnd_quiet_hours_v1';
const DND_QUIET_HOURS_WINDOW_KEY = 'ginit_profile_dnd_quiet_hours_window_v1';

/** 기본 시작: 오후 11시 */
export const DND_QUIET_HOURS_DEFAULT_START_MIN = 23 * 60;
/** 기본 종료: 오전 8시 */
export const DND_QUIET_HOURS_DEFAULT_END_MIN = 8 * 60;

export type ProfileDndQuietHoursWindow = {
  startMin: number;
  endMin: number;
};

function clampMin(m: number): number {
  if (!Number.isFinite(m)) return 0;
  return Math.min(1439, Math.max(0, Math.trunc(m)));
}

function parseWindowJson(raw: string | null): ProfileDndQuietHoursWindow | null {
  if (raw == null || raw.trim() === '') return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const rec = o as Record<string, unknown>;
    const s = rec.s ?? rec.startMin;
    const e = rec.e ?? rec.endMin;
    if (typeof s !== 'number' || typeof e !== 'number' || !Number.isFinite(s) || !Number.isFinite(e)) return null;
    return { startMin: clampMin(s), endMin: clampMin(e) };
  } catch {
    return null;
  }
}

export async function loadProfileDndQuietHoursEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(DND_QUIET_HOURS_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export async function saveProfileDndQuietHoursEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(DND_QUIET_HOURS_KEY, enabled ? '1' : '0');
}

export async function loadProfileDndQuietHoursWindow(): Promise<ProfileDndQuietHoursWindow> {
  try {
    const raw = await AsyncStorage.getItem(DND_QUIET_HOURS_WINDOW_KEY);
    const parsed = parseWindowJson(raw);
    if (parsed) return parsed;
  } catch {
    /* fall through */
  }
  return { startMin: DND_QUIET_HOURS_DEFAULT_START_MIN, endMin: DND_QUIET_HOURS_DEFAULT_END_MIN };
}

export async function saveProfileDndQuietHoursWindow(window: ProfileDndQuietHoursWindow): Promise<void> {
  const payload = JSON.stringify({
    s: clampMin(window.startMin),
    e: clampMin(window.endMin),
  });
  await AsyncStorage.setItem(DND_QUIET_HOURS_WINDOW_KEY, payload);
}

export async function loadProfileDndQuietHoursState(): Promise<{
  enabled: boolean;
  startMin: number;
  endMin: number;
}> {
  const [enabled, win] = await Promise.all([loadProfileDndQuietHoursEnabled(), loadProfileDndQuietHoursWindow()]);
  return { enabled, startMin: win.startMin, endMin: win.endMin };
}

/**
 * 방해금지가 켜져 있고, 현재 시각이 조용한 구간이면 true.
 * - 시작 > 종료: 같은 날 자정을 넘는 구간(예 23:00 ~ 익일 08:00)
 * - 시작 < 종료: 같은 날 안의 구간
 * - 시작 === 종료: 비활성(전 구간으로 보지 않음)
 */
export async function isProfileFcmQuietHoursActive(now: Date = new Date()): Promise<boolean> {
  const { enabled, startMin, endMin } = await loadProfileDndQuietHoursState();
  if (!enabled) return false;
  if (startMin === endMin) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (startMin > endMin) {
    return nowMin >= startMin || nowMin < endMin;
  }
  return nowMin >= startMin && nowMin < endMin;
}
