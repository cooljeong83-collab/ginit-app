/**
 * 일부 Android(예: 갤럭시 S9+)에서 루트 스택에 모임 상세 등이 올라간 뒤에도
 * `(tabs)/index`의 `BackHandler`가 포커스/언마운트 타이밍보다 먼저 살아 있어
 * 하드웨어 뒤로가기를 가로채는 경우가 있어, “탭 위에 다른 화면이 열렸을 때”
 * 탭의 이중 탭 종료 처리를 건너뛰게 합니다.
 */
let suppressDepth = 0;

/** 포커스 동안 호출하고, cleanup에서 반환한 함수를 blur 시 실행하세요. */
export function pushAndroidTabHomeHardwareExitSuppress(): () => void {
  suppressDepth += 1;
  return () => {
    suppressDepth = Math.max(0, suppressDepth - 1);
  };
}

export function isAndroidTabHomeHardwareExitSuppressed(): boolean {
  return suppressDepth > 0;
}
