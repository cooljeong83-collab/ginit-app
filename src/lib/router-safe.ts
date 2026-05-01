import type { Href, Router } from 'expo-router';

/** `expo-router`의 `useRouter()` 반환형과 호환 */
export type ExpoRouterLike = Pick<Router, 'back' | 'replace' | 'canGoBack'>;

/** 모임 나가기 성공 후 랜딩할 탭 (스택 정리 대상 경로) */
export type MeetingLeaveTabReset = 'index' | 'chat';

/** 모임 탭은 파일상 `(tabs)/index`이지만, 앱 전역에서 쓰는 유효 href는 `/(tabs)`입니다(`getStateFromPath`·`/(tabs)/index`는 Unmatched로 이어질 수 있음). */
const MEETING_LEAVE_TAB_HREF = {
  index: '/(tabs)',
  chat: '/(tabs)/chat',
} as const satisfies Record<MeetingLeaveTabReset, '/(tabs)' | '/(tabs)/chat'>;

/**
 * 참여자 모임 나가기 등으로 해당 모임 흐름이 끝났을 때,
 * 그 위에 쌓인 meeting / meeting-chat 등을 제거하고 탭만 남깁니다.
 * `dismissTo`는 내부적으로 예외를 던지지 않으므로, 경로가 잘못되면 조용히 실패할 수 있습니다.
 * 탭 href는 반드시 앱에서 이미 검증된 형태(`/(tabs)`, `/(tabs)/chat`)를 씁니다.
 */
export function resetStackToTabsAfterMeetingLeave(
  router: Router,
  opts?: { tab?: MeetingLeaveTabReset },
): void {
  const href = MEETING_LEAVE_TAB_HREF[opts?.tab ?? 'index'];
  const asHref = href as Href;
  router.dismissTo(asHref);
}

/** 스택이 비어 있을 때 `router.back()`이 GO_BACK 미처리로 터지는 것을 방지합니다. */
export function safeRouterBack(router: ExpoRouterLike): void {
  try {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
  } catch {
    /* fall through */
  }
  router.replace('/(tabs)' as Href);
}
