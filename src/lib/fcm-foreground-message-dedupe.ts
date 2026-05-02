import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';

const GLOBAL_ON_MESSAGE = '__ginitFcmForegroundOnMessageDedupeAt';
const GLOBAL_NOTIFEE = '__ginitFcmNotifeeDisplayDedupeAt';

const DEDUPE_MS = 12_000;

function getDedupeMap(key: typeof GLOBAL_ON_MESSAGE | typeof GLOBAL_NOTIFEE): Map<string, number> {
  const g = globalThis as unknown as Record<string, Map<string, number> | undefined>;
  let m = g[key];
  if (!m) {
    m = new Map();
    g[key] = m;
  }
  return m;
}

function pruneMap(map: Map<string, number>, now: number): void {
  if (map.size <= 200) return;
  const cutoff = now - DEDUPE_MS;
  for (const [k, t] of map) {
    if (t < cutoff) map.delete(k);
  }
}

/** FCM / data-only에서 messageId가 비어도 동일 수신을 묶을 수 있게 키를 만듭니다. */
export function fcmForegroundDedupeKey(rm: FirebaseMessagingTypes.RemoteMessage): string {
  const mid = String(rm.messageId ?? '').trim();
  if (mid) return mid;
  const collapse = String((rm as { collapseKey?: unknown }).collapseKey ?? '').trim();
  if (collapse) return `collapse:${collapse}`;
  const d = rm.data ?? {};
  const fromData = String(d.messageId ?? d['google.message_id'] ?? d.gcm_message_id ?? '').trim();
  if (fromData) return `data:${fromData}`;
  return '';
}

/** `onMessage` 콜백 첫 동기 구간 — 런타임 전역 맵(Metro 이중 묶음 대비). */
export function consumeForegroundOnMessageOnceGlobalSync(rm: FirebaseMessagingTypes.RemoteMessage): boolean {
  const dedupeKey = fcmForegroundDedupeKey(rm);
  if (!dedupeKey) return true;
  const now = Date.now();
  const map = getDedupeMap(GLOBAL_ON_MESSAGE);
  const prev = map.get(dedupeKey);
  if (prev !== undefined && now - prev < DEDUPE_MS) return false;
  map.set(dedupeKey, now);
  pruneMap(map, now);
  return true;
}

/** `notifee.displayNotification` 직전 동기 구간 — 포그라운드 리스너 누적 시 마지막 방어. */
export function consumeNotifeeDisplayOnceGlobalSync(rm: FirebaseMessagingTypes.RemoteMessage): boolean {
  const dedupeKey = fcmForegroundDedupeKey(rm);
  if (!dedupeKey) return true;
  const now = Date.now();
  const map = getDedupeMap(GLOBAL_NOTIFEE);
  const prev = map.get(dedupeKey);
  if (prev !== undefined && now - prev < DEDUPE_MS) return false;
  map.set(dedupeKey, now);
  pruneMap(map, now);
  return true;
}
