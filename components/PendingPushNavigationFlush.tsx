import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { consumePendingPushOpenPayload } from '@/src/lib/pending-push-navigation';
import { markAlarmReadFromPushData, navigateFromPushData } from '@/src/lib/push-open-navigation';

/**
 * 부트 중 저장된 푸시 탭 payload 를 **스플래시(`/`)에서 탭 진입으로 처음 전환될 때만** 라우팅합니다.
 * - `pathname`이 `/(tabs)/index` → `/(tabs)/chat` 로 바뀔 때마다 소비하면, 사용자가 채팅 탭을 눌렀을 때
 *   보류된 방으로 잘못 이동하는 부작용이 생깁니다.
 * - `getInitialNotification` 비동기보다 탭이 먼저 그려지면 pending 이 늦게 들어오므로, 전환 직후 몇 번 재시도합니다.
 */
export function PendingPushNavigationFlush() {
  const router = useRouter();
  const pathname = usePathname();
  const { userId, isHydrated } = useUserSession();
  const { markMeetingAlarmsReadByPushTap, markFriendRequestAlarmDismissed, markFriendAcceptedAlarmDismissed } =
    useInAppAlarms();
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!isHydrated || !userId?.trim()) return;

    const p = pathname.trim();
    const isSplash = p === '' || p === '/';

    if (isSplash) {
      prevPathRef.current = '/';
      ginitNotifyDbg('PendingPushFlush', 'on_splash_path', { pathname: p });
      return;
    }

    const prev = prevPathRef.current;
    prevPathRef.current = p;

    const transitionedFromSplash = prev === null || prev === '' || prev === '/';
    if (!transitionedFromSplash) {
      ginitNotifyDbg('PendingPushFlush', 'skip_not_splash_exit', { prev, next: p });
      return;
    }

    ginitNotifyDbg('PendingPushFlush', 'splash_exit_try_consume', { prev, next: p });

    const tryConsume = (phase: string): boolean => {
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
    };

    if (tryConsume('immediate')) return;

    ginitNotifyDbg('PendingPushFlush', 'schedule_retry_consume', {});
    const t1 = setTimeout(() => {
      void tryConsume('t120');
    }, 120);
    const t2 = setTimeout(() => {
      void tryConsume('t400');
    }, 400);
    const t3 = setTimeout(() => {
      void tryConsume('t1000');
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
    router,
    markMeetingAlarmsReadByPushTap,
    markFriendRequestAlarmDismissed,
    markFriendAcceptedAlarmDismissed,
  ]);

  return null;
}
