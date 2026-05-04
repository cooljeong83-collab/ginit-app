import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ginit_profile_notification_sound_v1';

/** 시스템 기본 + 번들에 포함된 커스텀 ID (확장 시 배열만 추가) */
export type ProfileBundledNotificationSoundId = 'ginit_ring_c1' | 'ginit_ring_w';

/** 신규·빈 저장값 기본 번들 알림음 */
const DEFAULT_BUNDLED_NOTIFICATION_SOUND_ID: ProfileBundledNotificationSoundId = 'ginit_ring_c1';

export type ProfileNotificationSoundId = 'default' | ProfileBundledNotificationSoundId;

export type ProfileNotificationSoundOption = {
  id: ProfileNotificationSoundId;
  /** 설정·모달에 표시 */
  label: string;
  /** expo-notifications `sounds`에 등록된 파일명 (커스텀일 때만) */
  expoFilename?: string;
};

export const PROFILE_NOTIFICATION_SOUND_OPTIONS: readonly ProfileNotificationSoundOption[] = [
  { id: 'default', label: '시스템 기본' },
  { id: 'ginit_ring_c1', label: '지닛 벨 1', expoFilename: 'ginit_ring_c1.wav' },
  { id: 'ginit_ring_w', label: '지닛 벨 2', expoFilename: 'ginit_ring_w.wav' },
] as const;

const BUNDLED_IDS = new Set<string>(PROFILE_NOTIFICATION_SOUND_OPTIONS.filter((o) => o.id !== 'default').map((o) => o.id));

function normalizeStored(raw: string | null): ProfileNotificationSoundId {
  const s = (raw ?? '').trim();
  if (s === 'default') return 'default';
  if (s === '') return DEFAULT_BUNDLED_NOTIFICATION_SOUND_ID;
  if (BUNDLED_IDS.has(s)) return s as ProfileBundledNotificationSoundId;
  return DEFAULT_BUNDLED_NOTIFICATION_SOUND_ID;
}

export async function loadProfileNotificationSoundId(): Promise<ProfileNotificationSoundId> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    return normalizeStored(v);
  } catch {
    return DEFAULT_BUNDLED_NOTIFICATION_SOUND_ID;
  }
}

export async function saveProfileNotificationSoundId(id: ProfileNotificationSoundId): Promise<void> {
  const next = id === 'default' || BUNDLED_IDS.has(id) ? id : DEFAULT_BUNDLED_NOTIFICATION_SOUND_ID;
  await AsyncStorage.setItem(STORAGE_KEY, next);
}

export function labelForProfileNotificationSoundId(id: ProfileNotificationSoundId): string {
  const hit = PROFILE_NOTIFICATION_SOUND_OPTIONS.find((o) => o.id === id);
  return hit?.label ?? '시스템 기본';
}

/** Android `res/raw` 베이스명 (확장자 없음) — expo 플러그인이 소문자·밑줄 규칙으로 복사 */
export function notifeeAndroidRawBaseName(id: ProfileNotificationSoundId): string | null {
  if (id === 'default') return null;
  const o = PROFILE_NOTIFICATION_SOUND_OPTIONS.find((x) => x.id === id);
  if (!o?.expoFilename) return null;
  return o.expoFilename.replace(/\.[^/.]+$/, '');
}

/**
 * Notifee FCM 표시용 채널 ID (선택이 바뀔 때마다 다른 ID — Android 채널 소리는 생성 후 변경 불가)
 * 레거시 `ginit_fcm` 채널은 `ensureGinitFcmNotifeeChannel`에서 별도 유지합니다.
 */
export async function getGinitFcmDisplayNotifeeChannelId(): Promise<string> {
  const pref = await loadProfileNotificationSoundId();
  if (pref === 'default') return 'ginit_fcm_w_default';
  const raw = notifeeAndroidRawBaseName(pref);
  if (!raw) return 'ginit_fcm_w_default';
  return `ginit_fcm_w_${raw}`;
}

/** Expo 로컬 알림 `content.sound` (iOS 번들 파일명 / default) */
export async function getExpoNotificationContentSound(): Promise<boolean | 'default' | string> {
  const pref = await loadProfileNotificationSoundId();
  if (pref === 'default') return 'default';
  const o = PROFILE_NOTIFICATION_SOUND_OPTIONS.find((x) => x.id === pref);
  return o?.expoFilename ?? 'default';
}

/**
 * Android `expo-notifications` 채널용 ID (`setNotificationChannelAsync`도 생성 후 소리 변경 불가)
 */
export async function getGinitInAppAndroidChannelId(): Promise<string> {
  const pref = await loadProfileNotificationSoundId();
  if (pref === 'default') return 'ginit_in_app_w_default';
  const raw = notifeeAndroidRawBaseName(pref);
  if (!raw) return 'ginit_in_app_w_default';
  return `ginit_in_app_w_${raw}`;
}
