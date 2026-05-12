import { usePathname, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { DeviceEventEmitter, Platform } from 'react-native';

import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import {
  consumePendingPushOpenPayload,
  GINIT_PUSH_OPEN_PENDING_SET,
  peekPendingPushOpenPayload,
} from '@/src/lib/pending-push-navigation';
import { markAlarmReadFromPushData, navigateFromPushData } from '@/src/lib/push-open-navigation';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
import { GINIT_SPLASH_REPLACED_TO_TABS } from '@/src/lib/splash-to-tabs-navigation';

/**
 * 부트 중 저장된 푸시 탭 payload 를 **스플래시(`/`)에서 탭 진입으로 처음 전환될 때만** 라우팅합니다.
 * - `pathname`이 `/(tabs)/index` → `/(tabs)/chat` 로 바뀔 때마다 소비하면, 사용자가 채팅 탭을 눌렀을 때
 *   보류된 방으로 잘못 이동하는 부작용이 생깁니다.
 * - `getInitialNotification` 비동기보다 탭이 먼저 그려지면 pending 이 늦게 들어오므로, 전환 직후 몇 번 재시도합니다.
 */
export function PendingPushNavigationFlush() {
  const router = useTransitionRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const { userId, isHydrated } = useUserSession();
  const { markMeetingAlarmsReadByPushTap, markFriendRequestAlarmDismissed, markFriendAcceptedAlarmDismissed } =
    useInAppAlarms();
  const prevPathRef = useRef<string | null>(null);

  const consumePendingPushIfAny = useCallback(
    (phase: string): boolean => {
      const pending = consumePendingPushOpenPayload();
      if (!pending) {
        ginitNotifyDbg('PendingPushFlush', 'consume_miss', { phase });
        return false;
      }
      ginitNotifyDbg('PendingPushFlush', 'consume_hit_navigate', { phase });
      navigateFromPushData(router, pending, { replace: true, currentPathname: pathname });
      void markAlarmReadFromPushData(
        pending,
        markMeetingAlarmsReadByPushTap,
        markFriendRequestAlarmDismissed,
        markFriendAcceptedAlarmDismissed,
      );
      return true;
    },
    [
      router,
      pathname,
      markMeetingAlarmsReadByPushTap,
      markFriendRequestAlarmDismissed,
      markFriendAcceptedAlarmDismissed,
    ],
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = DeviceEventEmitter.addListener(GINIT_SPLASH_REPLACED_TO_TABS, () => {
      if (!peekPendingPushOpenPayload()) return;
      ginitNotifyDbg('PendingPushFlush', 'splash_to_tabs_event', {});
      queueMicrotask(() => {
        if (!isHydrated || !userId?.trim()) return;
        void consumePendingPushIfAny('splash_to_tabs_emit');
      });
    });
    return () => sub.remove();
  }, [isHydrated, userId, consumePendingPushIfAny]);

  /** 스플래시 이탈보다 `setPending` 이 늦게 오는 경우(콜드 오픈 getInitial* 등) */
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = DeviceEventEmitter.addListener(GINIT_PUSH_OPEN_PENDING_SET, () => {
      if (!isHydrated || !userId?.trim()) return;
      if (!peekPendingPushOpenPayload()) return;
      const p = pathname.trim();
      const inTabsGroup = Array.isArray(segments) && segments.some((s) => s === '(tabs)');
      const stillBootstrapSplash = (p === '' || p === '/') && !inTabsGroup;
      if (stillBootstrapSplash) {
        ginitNotifyDbg('PendingPushFlush', 'pending_set_emit_still_splash_skip', {});
        return;
      }
      ginitNotifyDbg('PendingPushFlush', 'pending_set_emit_try_consume', { pathname: p });
      queueMicrotask(() => {
        if (!isHydrated || !userId?.trim()) return;
        void consumePendingPushIfAny('pending_set_emit');
      });
    });
    return () => sub.remove();
  }, [isHydrated, userId, pathname, segments, consumePendingPushIfAny]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!isHydrated || !userId?.trim()) return;

    const p = pathname.trim();
    /** `usePathname()`이 `/(tabs)` 진입 후에도 `/`로 남는 경우가 있어, 세그먼트로 탭 트리 진입을 함께 본다. */
    const inTabsGroup = Array.isArray(segments) && segments.some((s) => s === '(tabs)');
    const isBootstrapSplashOnly = (p === '' || p === '/') && !inTabsGroup;

    if (isBootstrapSplashOnly) {
      prevPathRef.current = '/';
      ginitNotifyDbg('PendingPushFlush', 'on_splash_path', { pathname: p, segmentHead: segments[0] });
      return;
    }

    if ((p === '' || p === '/') && inTabsGroup) {
      ginitNotifyDbg('PendingPushFlush', 'pathname_stale_but_tabs_segments', {
        segmentPreview: segments.slice(0, 6).join('/'),
      });
    }

    const prev = prevPathRef.current;
    prevPathRef.current = p;

    const transitionedFromSplash = prev === null || prev === '' || prev === '/';
    if (!transitionedFromSplash) {
      ginitNotifyDbg('PendingPushFlush', 'skip_not_splash_exit', { prev, next: p });
      return;
    }

    const hadPendingPeek = Boolean(peekPendingPushOpenPayload());
    ginitNotifyDbg('PendingPushFlush', 'splash_exit_try_consume', { prev, next: p, hadPendingPeek });

    if (consumePendingPushIfAny('immediate')) return;

    if (!hadPendingPeek) {
      ginitNotifyDbg('PendingPushFlush', 'splash_exit_no_pending_skip_retries', {});
      return;
    }

    ginitNotifyDbg('PendingPushFlush', 'schedule_retry_consume', {});
    const t1 = setTimeout(() => {
      void consumePendingPushIfAny('t120');
    }, 120);
    const t2 = setTimeout(() => {
      void consumePendingPushIfAny('t400');
    }, 400);
    const t3 = setTimeout(() => {
      void consumePendingPushIfAny('t1000');
    }, 1000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [
    isHydrated,
    userId,
    pathname,
    segments,
    router,
    markMeetingAlarmsReadByPushTap,
    markFriendRequestAlarmDismissed,
    markFriendAcceptedAlarmDismissed,
    consumePendingPushIfAny,
  ]);

  return null;
}
