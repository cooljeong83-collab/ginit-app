import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { publicEnv } from '@/src/config/public-env';

/** NCP Static Map (Raster) — Application Maps 게이트웨이 */
const NAVER_STATIC_MAP_ORIGIN = 'https://naveropenapi.apigw.ntruss.com';
const STATIC_MAP_ASPECT_RATIO = 2;
const STATIC_MAP_MIN_WIDTH_PX = 400;
const STATIC_MAP_MAX_WIDTH_PX = 1024;

function buildStaticRasterUri(lng: number, lat: number, w: number, h: number): string {
  const markers = `type:d|size:mid|pos:${lng} ${lat}`;
  const q = new URLSearchParams({
    w: String(w),
    h: String(h),
    center: `${lng},${lat}`,
    level: '16',
    markers,
  });
  return `${NAVER_STATIC_MAP_ORIGIN}/map-static/v2/raster?${q.toString()}`;
}

function ncpStaticMapHeaders(apiKeyId: string, apiKey: string): Record<string, string> {
  return {
    'X-NCP-APIGW-API-KEY-ID': apiKeyId.trim(),
    'X-NCP-APIGW-API-KEY': apiKey.trim(),
  };
}

type Props = {
  latitude: number;
  longitude: number;
};

/**
 * 장소 좌표 미리보기 — Raster Static Map (헤더 인증, URL에 시크릿 미포함).
 */
export function NaverStaticRasterPreview({ latitude, longitude }: Props) {
  const apiKeyId = publicEnv.naverLocalClientId || publicEnv.naverMapClientId;
  const apiKey = publicEnv.naverLocalClientSecret;
  const [layoutWidth, setLayoutWidth] = useState(STATIC_MAP_MIN_WIDTH_PX);

  const rasterSize = useMemo(() => {
    const scale = Math.min(3, Math.max(1, PixelRatio.get()));
    const widthPx = Math.min(
      STATIC_MAP_MAX_WIDTH_PX,
      Math.max(STATIC_MAP_MIN_WIDTH_PX, Math.ceil(layoutWidth * scale)),
    );
    return {
      width: widthPx,
      height: Math.max(200, Math.ceil(widthPx / STATIC_MAP_ASPECT_RATIO)),
    };
  }, [layoutWidth]);

  const source = useMemo(() => {
    if (!apiKeyId || !apiKey) return null;
    const uri = buildStaticRasterUri(longitude, latitude, rasterSize.width, rasterSize.height);
    return { uri, headers: ncpStaticMapHeaders(apiKeyId, apiKey) };
  }, [apiKey, apiKeyId, latitude, longitude, rasterSize.height, rasterSize.width]);

  const onBoxLayout = useCallback((e: LayoutChangeEvent) => {
    const next = Math.max(1, Math.floor(e.nativeEvent.layout.width));
    setLayoutWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next));
  }, []);

  if (!source) {
    return (
      <View style={styles.box} onLayout={onBoxLayout}>
        <Text style={styles.muted}>NCP Maps 클라이언트 ID·Secret이 없어 지도를 불러올 수 없습니다.</Text>
      </View>
    );
  }

  return (
    <View style={styles.box} onLayout={onBoxLayout}>
      <Image
        source={source}
        style={styles.image}
        contentFit="cover"
        accessibilityLabel="선택한 장소 위치 미리보기"
        cachePolicy="memory-disk"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: '100%',
    aspectRatio: STATIC_MAP_ASPECT_RATIO,
    borderRadius: 15,
    overflow: 'hidden',
    flexShrink: 0,
    backgroundColor: 'rgba(226, 232, 240, 0.65)',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 15,
  },
  muted: { fontSize: 13, color: '#64748b', paddingHorizontal: 12, textAlign: 'center' },
});
