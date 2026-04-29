#!/usr/bin/env python3
"""
Android 알림 small icon용 drawable 생성.

가이드(Android / Material):
- 로고 실루엣만 불투명(#FFFFFF)으로, 배경은 완전 투명(alpha=0).
- OS가 상태 표시줄·테마 대비에 맞춰 단색으로 틴트(밝은 배경에서는 어둡게 등).
- `expo-notifications` 플러그인과 동일한 밀도별 크기(24dp 기준 × scale).

사용: pip install pillow && python3 scripts/regenerate-android-notification-icons.py
"""
from __future__ import annotations

import os
import sys

try:
    from PIL import Image
except ImportError:
    print('Pillow 필요: pip install pillow', file=sys.stderr)
    sys.exit(1)

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(REPO, 'assets/images/notification_icon_monochrome.png')
RES = os.path.join(REPO, 'android/app/src/main/res')
SIZES = {
    'drawable-mdpi': 24,
    'drawable-hdpi': 36,
    'drawable-xhdpi': 48,
    'drawable-xxhdpi': 72,
    'drawable-xxxhdpi': 96,
}


def white_silhouette(im: Image.Image) -> Image.Image:
    im = im.convert('RGBA')
    _, _, _, a = im.split()
    white = Image.new('L', im.size, 255)
    return Image.merge('RGBA', (white, white, white, a))


def cover_square(im: Image.Image, size: int) -> Image.Image:
    im = im.convert('RGBA')
    w, h = im.size
    scale = max(size / w, size / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - size) // 2
    top = (nh - size) // 2
    return im2.crop((left, top, left + size, top + size))


def main() -> None:
    if not os.path.isfile(SRC):
        print(f'소스 없음: {SRC}', file=sys.stderr)
        sys.exit(1)
    base = white_silhouette(Image.open(SRC))
    for folder, px in SIZES.items():
        out_dir = os.path.join(RES, folder)
        os.makedirs(out_dir, exist_ok=True)
        out = cover_square(base, px)
        out_path = os.path.join(out_dir, 'notification_icon.png')
        out.save(out_path, optimize=True)
        print(out_path, out.size)


if __name__ == '__main__':
    main()
