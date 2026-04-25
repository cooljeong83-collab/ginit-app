/** `expo-router`의 `useRouter()` 반환형과 호환되는 최소 인터페이스 */
export type ExpoRouterLike = {
  back: () => void;
  replace: (href: string) => void;
  canGoBack?: () => boolean;
};

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
  router.replace('/(tabs)');
}
