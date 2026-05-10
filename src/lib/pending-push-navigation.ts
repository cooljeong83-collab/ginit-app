/**
 * 앱 부트(스플래시) 중 `router.replace('/(tabs)')`가 푸시 딥링크를 덮어쓰는 것을 막기 위해
 * 세션(`isHydrated` + `userId`) 준비 전 수신한 푸시 payload 를 잠시 보관합니다.
 */
import { DeviceEventEmitter, Platform } from 'react-native';

import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';

/** `setPendingPushOpenPayload` 성공 직후 — 스플래시 이탈보다 늦게 pending 이 오는 경우 `PendingPushNavigationFlush`에서 소비 */
export const GINIT_PUSH_OPEN_PENDING_SET = 'ginit_push_open_pending_set_v1';

let pendingPayload: Record<string, unknown> | null = null;

function keysPreview(data: Record<string, unknown>): string {
  return Object.keys(data)
    .slice(0, 24)
    .join(',');
}

export function setPendingPushOpenPayload(data: Record<string, unknown> | undefined): boolean {
  if (!data || typeof data !== 'object') return false;
  const keys = Object.keys(data).filter((k) => k.trim().length > 0);
  if (keys.length === 0) return false;
  pendingPayload = { ...data };
  ginitNotifyDbg('pending-push-nav', 'set', {
    keyCount: keys.length,
    keysPreview: keysPreview(pendingPayload),
    action: typeof pendingPayload.action === 'string' ? pendingPayload.action : undefined,
  });
  if (Platform.OS !== 'web') {
    DeviceEventEmitter.emit(GINIT_PUSH_OPEN_PENDING_SET);
  }
  return true;
}

export function peekPendingPushOpenPayload(): Record<string, unknown> | null {
  return pendingPayload;
}

export function consumePendingPushOpenPayload(): Record<string, unknown> | null {
  const out = pendingPayload;
  pendingPayload = null;
  ginitNotifyDbg('pending-push-nav', 'consume', {
    had: Boolean(out),
    keysPreview: out ? keysPreview(out) : undefined,
  });
  return out;
}

export function clearPendingPushOpenPayload(): void {
  if (pendingPayload) {
    ginitNotifyDbg('pending-push-nav', 'clear_logout_or_explicit', { had: true });
  }
  pendingPayload = null;
}

/** 스플래시(`/`) 또는 세션 미준비 시에는 라우팅을 미루고, 탭 스택이 올라온 뒤 `PendingPushNavigationFlush`에서 소비합니다. */
export function explainShouldDeferPushOpenNavigation(opts: {
  isHydrated: boolean;
  userId: string | null | undefined;
  pathname: string;
}): 'not_hydrated' | 'no_user_id' | 'splash_route' | null {
  if (!opts.isHydrated) return 'not_hydrated';
  if (!String(opts.userId ?? '').trim()) return 'no_user_id';
  const p = opts.pathname.trim();
  if (p === '' || p === '/') return 'splash_route';
  return null;
}

export function shouldDeferPushOpenNavigation(opts: {
  isHydrated: boolean;
  userId: string | null | undefined;
  pathname: string;
}): boolean {
  return explainShouldDeferPushOpenNavigation(opts) != null;
}
