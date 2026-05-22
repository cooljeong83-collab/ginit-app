type MeetingTabCreateFabPressHandler = () => void;

let handler: MeetingTabCreateFabPressHandler | null = null;

/** `GinitTabBar` — 모임 생성 FAB `onPress` 위임 */
export function registerMeetingTabCreateFabPressHandler(
  fn: MeetingTabCreateFabPressHandler | null,
): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

/** Android 터치 쉴드 등 — 탭바 FAB와 동일한 생성 플로우 실행 */
export function requestMeetingTabCreateFabPress(): void {
  handler?.();
}
