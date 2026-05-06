import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Image as RNImage, View, type StyleProp, type ViewStyle } from 'react-native';

import type { ProfilePhotoCover } from '@/src/lib/profile-photo-cover';

type Props = {
  uri: string;
  size: number;
  borderRadius: number;
  cover?: ProfilePhotoCover | null;
  style?: StyleProp<ViewStyle>;
};

/**
 * 원형(또는 라운드) 클립 안에서 `photo_cover` 초점(ax, ay, z)에 맞춰 원본 비율 이미지를 배치합니다.
 * 메타가 없으면 중앙·기본 배율과 동일하게 보입니다.
 */
export function ProfileSquareAvatar({ uri, size, borderRadius, cover, style }: Props) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDims(null);
    const u = uri.trim();
    if (!u) return;
    RNImage.getSize(
      u,
      (w, h) => {
        if (cancelled) return;
        if (w > 0 && h > 0) setDims({ w, h });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const layout = useMemo(() => {
    if (!dims) return null;
    const ax = cover?.ax ?? 0.5;
    const ay = cover?.ay ?? 0.5;
    const z = cover?.z ?? 1;
    const s = Math.max(size / dims.w, size / dims.h);
    const W = dims.w * s * z;
    const H = dims.h * s * z;
    const left = size / 2 - ax * W;
    const top = size / 2 - ay * H;
    return { W, H, left, top };
  }, [dims, size, cover]);

  return (
    <View style={[{ width: size, height: size, borderRadius, overflow: 'hidden' }, style]}>
      {layout ? (
        <Image
          source={{ uri }}
          style={{ position: 'absolute', width: layout.W, height: layout.H, left: layout.left, top: layout.top }}
          contentFit="fill"
        />
      ) : (
        <Image source={{ uri }} style={{ width: size, height: size }} contentFit="cover" />
      )}
    </View>
  );
}
