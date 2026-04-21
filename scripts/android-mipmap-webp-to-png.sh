#!/usr/bin/env bash
# Expo prebuild이 mipmap 런처를 .webp로 만들 때, 검수/일부 런처 요구에 맞춰 .png로 바꿉니다 (macOS `sips` 필요).
# 이어서 전경/모노크롬 비트맵을 *_base 로 두고, adaptive용 drawable + anydpi-v26 XML을 템플릿에서 복사합니다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/android/app/src/main/res"
TPL="$ROOT/scripts/templates/android-res"
if ! command -v sips >/dev/null 2>&1; then
  echo "sips not found (macOS only). Skip or install ImageMagick and adjust this script." >&2
  exit 1
fi
for dir in mipmap-hdpi mipmap-mdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi; do
  D="$RES/$dir"
  [[ -d "$D" ]] || continue
  for f in "$D"/*.webp; do
    [[ -f "$f" ]] || continue
    base="${f%.webp}"
    if [[ -f "${base}.png" ]]; then
      rm "$f"
      continue
    fi
    sips -s format png "$f" --out "${base}.png" >/dev/null
    rm "$f"
  done
done

for dir in mipmap-hdpi mipmap-mdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi; do
  D="$RES/$dir"
  [[ -d "$D" ]] || continue
  if [[ -f "$D/ic_launcher_foreground.png" ]]; then
    mv -f "$D/ic_launcher_foreground.png" "$D/ic_launcher_fg_base.png"
  fi
  if [[ -f "$D/ic_launcher_monochrome.png" ]]; then
    mv -f "$D/ic_launcher_monochrome.png" "$D/ic_launcher_mono_base.png"
  fi
done

if [[ -d "$TPL" ]]; then
  mkdir -p "$RES/drawable" "$RES/mipmap-anydpi-v26" "$RES/values"
  [[ -f "$TPL/values/dimens.xml" ]] && cp -f "$TPL/values/dimens.xml" "$RES/values/"
  [[ -f "$TPL/drawable/ic_launcher_background.xml" ]] && cp -f "$TPL/drawable/ic_launcher_background.xml" "$RES/drawable/"
  cp -f "$TPL/drawable/ic_launcher_foreground.xml" "$RES/drawable/"
  cp -f "$TPL/drawable/ic_launcher_monochrome.xml" "$RES/drawable/"
  cp -f "$TPL/mipmap-anydpi-v26/ic_launcher.xml" "$RES/mipmap-anydpi-v26/"
  cp -f "$TPL/mipmap-anydpi-v26/ic_launcher_round.xml" "$RES/mipmap-anydpi-v26/"
fi

echo "Mipmap launchers: webp→png, fg/mono → *_base, adaptive drawable 템플릿 적용 완료 ($RES)"
