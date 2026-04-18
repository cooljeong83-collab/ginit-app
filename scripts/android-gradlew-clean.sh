#!/usr/bin/env bash
# Android Gradle 캐시·빌드 산출물 정리. JDK 17이 필요합니다 (class major 61).
# macOS 예: export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/android"

if ! command -v java >/dev/null 2>&1; then
  echo "java 가 PATH에 없습니다." >&2
  exit 1
fi

JAVA_VER="$(java -version 2>&1 | head -1 || true)"
echo "Using: $JAVA_VER"
echo "JAVA_HOME=${JAVA_HOME:-<unset>}"

./gradlew clean "$@"
