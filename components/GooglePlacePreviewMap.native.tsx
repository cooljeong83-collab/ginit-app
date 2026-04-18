import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

type Props = {
  latitude: number;
  longitude: number;
  /** 기본 180 — 지닛 카드·장소 검색 미리보기 */
  height?: number;
  /** 외곽·맵 모서리 라운드 (기본 15) */
  borderRadius?: number;
};

const DEFAULT_DELTA = 0.007;

export function GooglePlacePreviewMap({ latitude, longitude, height = 180, borderRadius = 15 }: Props) {
  const region = useMemo(
    () => ({
      latitude,
      longitude,
      latitudeDelta: DEFAULT_DELTA,
      longitudeDelta: DEFAULT_DELTA,
    }),
    [latitude, longitude],
  );

  return (
    <View style={[styles.box, { height, borderRadius }]} collapsable={false}>
      <MapView
        key={`${latitude.toFixed(6)}-${longitude.toFixed(6)}`}
        provider={PROVIDER_GOOGLE}
        style={[styles.map, { borderRadius }]}
        initialRegion={region}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        toolbarEnabled={false}
        mapType="standard"
        accessibilityLabel="선택한 장소 위치">
        <Marker coordinate={{ latitude, longitude }} />
      </MapView>
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
