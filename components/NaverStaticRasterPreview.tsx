import { Image } from 'expo-image';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { publicEnv } from '@/src/config/public-env';

/** NCP Static Map (Raster) — Application Maps 게이트웨이 */
const NAVER_STATIC_MAP_ORIGIN = 'https://naveropenapi.apigw.ntruss.com';

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

  const source = useMemo(() => {
    if (!apiKeyId || !apiKey) return null;
    const uri = buildStaticRasterUri(longitude, latitude, 400, 200);
    return { uri, headers: ncpStaticMapHeaders(apiKeyId, apiKey) };
  }, [apiKey, apiKeyId, latitude, longitude]);

  if (!source) {
    return (
      <View style={styles.box}>
        <Text style={styles.muted}>NCP Maps 클라이언트 ID·Secret이 없어 지도를 불러올 수 없습니다.</Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
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
    height: 180,
    borderRadius: 15,
    overflow: 'hidden',
    flexShrink: 0,
    backgroundColor: 'rgba(226, 232, 240, 0.65)',
  },
  image: {
    width: '100%',
    height: 180,
    borderRadius: 15,
  },
  muted: { fontSize: 13, color: '#64748b', paddingHorizontal: 12, textAlign: 'center' },
});
