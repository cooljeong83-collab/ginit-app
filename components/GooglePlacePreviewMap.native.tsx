import { NaverMapMarkerOverlay, NaverMapView, type Region } from '@mj-studio/react-native-naver-map';
import { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { centerRegionToNaverRegion, type CenterLatLngRegion } from '@/src/lib/naver-map-region';

type Props = {
  latitude: number;
  longitude: number;
  /** 기본 180 — 지닛 카드·장소 검색 미리보기 */
  height?: number;
  /** 외곽·맵 모서리 라운드 (기본 15) */
  borderRadius?: number;
  /**
   * Android Fabric: 화면에 `NaverMapView`가 둘 이상이면 `RNCNaverMapViewManager.getChildAt` OOB 크래시가
   * 재현될 수 있어, 다른 전체화면 맵(예: 장소 인증 모달)이 열릴 때 미리보기 네이티브 맵만 내립니다.
   */
  suppressNativeMap?: boolean;
};

const DEFAULT_DELTA = 0.007;

export function GooglePlacePreviewMap({
  latitude,
  longitude,
  height = 180,
  borderRadius = 15,
  suppressNativeMap,
}: Props) {
  const initialRegion = useMemo((): Region => {
    const center: CenterLatLngRegion = {
      latitude,
      longitude,
      latitudeDelta: DEFAULT_DELTA,
      longitudeDelta: DEFAULT_DELTA,
    };
    return centerRegionToNaverRegion(center);
  }, [latitude, longitude]);

  if (Platform.OS === 'android' && suppressNativeMap) {
    return <View style={[styles.box, { height, borderRadius }]} collapsable={false} accessibilityLabel="선택한 장소 위치" />;
  }

  return (
    <View style={[styles.box, { height, borderRadius }]} collapsable={false}>
      <NaverMapView
        key={`${latitude.toFixed(6)}-${longitude.toFixed(6)}`}
        style={[styles.map, { borderRadius }]}
        initialRegion={initialRegion}
        isScrollGesturesEnabled={false}
        isZoomGesturesEnabled={false}
        isTiltGesturesEnabled={false}
        isRotateGesturesEnabled={false}
        isShowZoomControls={false}
        isShowCompass={false}
        isShowScaleBar={false}
        isShowLocationButton={false}
        isLiteModeEnabled
        isExtentBoundedInKorea
        locale="ko"
        {...(Platform.OS === 'android' ? { isUseTextureViewAndroid: true } : {})}
        accessibilityLabel="선택한 장소 위치">
        <NaverMapMarkerOverlay latitude={latitude} longitude={longitude} />
      </NaverMapView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: '100%',
    overflow: 'hidden',
    flexShrink: 0,
    backgroundColor: 'rgba(226, 232, 240, 0.85)',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
});
