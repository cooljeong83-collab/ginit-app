import { Platform, StyleSheet, Text, View } from 'react-native';

import { GooglePlacePreviewMap } from '@/components/GooglePlacePreviewMap';

type Props = {
  latitude: number | null;
  longitude: number | null;
  /** 호환용 — Google 기본 마커만 사용하며 표시하지 않음 */
  caption?: string;
  /** 등록 화면 등 — 낮은 높이의 미리보기 */
  compact?: boolean;
  /** `compact`일 때 높이(px). 기본 180 */
  compactHeight?: number;
  /** 호환용 — 마커 캡션 미사용 */
  hideCaption?: boolean;
};

/**
 * 모임 등록 등에서 좌표 미리보기.
 * 좌표는 네이버 검색·NCP 지오코딩으로 확보하고, 지도 타일은 `react-native-maps`(PROVIDER_GOOGLE)로 렌더합니다.
 *
 * @mj-studio/react-native-naver-map 네이티브 뷰는 제거(미사용)했습니다. 패키지·app.config 플러그인은 유지합니다.
 */
export function PlacePreviewMap({
  latitude,
  longitude,
  compact,
  compactHeight,
}: Props) {
  const previewHeight = compact ? (compactHeight ?? 180) : 220;

  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          styles.fallback,
          compact && styles.fallbackCompact,
          compact ? { height: previewHeight, minHeight: previewHeight } : null,
        ]}>
        <Text style={styles.fallbackText}>지도 미리보기는 모바일 앱에서만 제공됩니다.</Text>
      </View>
    );
  }

  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return (
      <View
        style={[
          styles.fallback,
          compact && styles.fallbackCompact,
          compact ? { height: previewHeight, minHeight: previewHeight } : null,
        ]}>
        <Text style={styles.fallbackText}>목록에서 장소를 선택하면 지도가 표시됩니다.</Text>
      </View>
    );
  }

  return <GooglePlacePreviewMap latitude={latitude} longitude={longitude} height={previewHeight} />;
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    minHeight: 200,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  fallbackCompact: {
    flex: 0,
    flexShrink: 0,
    alignSelf: 'stretch',
    width: '100%',
    borderRadius: 15,
    borderWidth: 0,
    overflow: 'hidden',
  },
  fallbackText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
    lineHeight: 20,
  },
});
