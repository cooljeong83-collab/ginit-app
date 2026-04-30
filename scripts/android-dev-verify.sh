#!/usr/bin/env bash
# 에뮬레이터/실기기 연결 후 Metro(8081) 역방향 프록시 + RN 로그 덤프.
# 사용: 에뮬레이터 실행 → ./scripts/android-dev-verify.sh
# 그다음 다른 터미널에서 `npx expo start --localhost` 후 `npm run android`
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb를 찾을 수 없습니다. Android SDK platform-tools PATH를 설정하세요."
  exit 1
fi

DEVICE_COUNT="$(adb devices | awk 'NR>1 && $2=="device"{c++} END{print c+0}')"
if [[ "${DEVICE_COUNT}" == "0" ]]; then
  echo "연결된 기기/에뮬레이터가 없습니다. AVD를 부팅한 뒤 adb devices에 device가 보이게 하세요."
  exit 2
fi

echo "연결된 device 수: ${DEVICE_COUNT}"
echo "Metro 포트 역방향: adb reverse tcp:8081 tcp:8081"
adb reverse tcp:8081 tcp:8081 || true

echo ""
echo "=== 최근 RN / AndroidRuntime 로그 (필터) ==="
adb logcat -d -t 500 '*:S' 'ReactNativeJS:I' 'ReactNative:V' 'AndroidRuntime:E' 2>/dev/null | tail -150 || true

echo ""
echo "다음 단계:"
echo "  1) npx expo start --localhost   (또는 CI=1 npx expo start --localhost)"
echo "  2) npm run android"
