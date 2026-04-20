/**
 * 웹(SSR·정적 export)에서는 `expo-notifications`가 모듈 로드 시점에 localStorage에 접근해
 * Node 환경에서 크래시할 수 있어, 네이티브 전용 구현과 분리합니다.
 */
export function PushNotificationBootstrap() {
  return null;
}
